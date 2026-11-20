import { KeyObject } from "node:crypto";
import https from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import { CredentialStoreError } from "src/model/error/CredentialStoreError.js";
import { isCloudFoundryEnvironment } from "src/util/env.js";
import { decryptJwe, parseRsaPrivateKey } from "src/util/jwe.js";
import { log } from "src/util/logger.js";

export const USE_BTP_CREDENTIAL_STORE_ENV = "USE_BTP_CREDENTIAL_STORE";

/**
 * Environment variables holding secrets. With the Credential Store enabled, they are expected to come from the
 * Credential Store and not from the environment / .env file anymore.
 */
export const SECRET_ENV_VARIABLES = ["GITHUB_TOKEN", "WEBHOOK_SECRET", "BASIC_AUTH"];

/**
 * Runtime and platform variables that must not be set from the Credential Store, as they could e.g. disable TLS
 * verification (NODE_TLS_REJECT_UNAUTHORIZED) or alter the bindings (VCAP_SERVICES).
 */
const PROTECTED_ENV_PREFIXES = ["NODE_", "VCAP_", "CF_"];
const PROTECTED_ENV_VARIABLES = [USE_BTP_CREDENTIAL_STORE_ENV];
/** Configuration that may be stored in the Credential Store although it has a protected prefix */
const UNPROTECTED_ENV_VARIABLES = ["CF_MTLS_TRUSTED_CERTS"];
const PROTECTED_ENV_DESCRIPTION = `${PROTECTED_ENV_PREFIXES.map((prefix) => `${prefix}*`).join(", ")}, ${PROTECTED_ENV_VARIABLES.join(", ")}`;

const CREDSTORE_SERVICE_LABEL = "credstore";
const NAMESPACE_HEADER = "sapcp-credstore-namespace";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_LIST_PAGES = 100;
const MAX_RETRIES = 5;
// Rate limiting and temporary outages are retried instead of stopping the server right away
const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"]);
const MAX_RETRY_DELAY_MS = 10_000;
const MAX_ERROR_DETAIL_LENGTH = 300;
const DISABLE_HINT = `or set ${USE_BTP_CREDENTIAL_STORE_ENV}=false`;
const BIND_EXAMPLE = `cf bind-service <app> <credstore-instance> -c '{"authorization":{"namespace_permissions":{"<namespace>":["list","read"]}}}'`;
const ENV_SECRET_DEPRECATION =
  "Providing secrets via environment variables or the .env file is deprecated on Cloud Foundry and will no longer be supported in an upcoming version.";

type CredentialStoreAuth =
  { type: "basic"; username: string; password: string } | { type: "mtls"; certificate: string; key: string };

export interface CredentialStoreBinding {
  /** Name of the bound service instance, used in log and error messages */
  name: string;
  /** Base URL of the credentials REST API, e.g. https://credstore.mesh.cf.eu10.hana.ondemand.com/api/v1/credentials */
  url: string;
  auth: CredentialStoreAuth;
  /** Decrypts JWE response payloads. Missing if payload encryption is disabled for the service instance. */
  clientPrivateKey?: KeyObject;
  /** Namespaces the binding was granted access to via `namespace_permissions` */
  namespaces: string[];
}

export interface CredentialStoreSecret {
  value: string;
  /** `<binding>/<namespace>` the value was read from */
  source: string;
}

export interface HttpResponse {
  statusCode: number;
  contentType: string | undefined;
  retryAfter: string | undefined;
  body: string;
}

export interface HttpGetOptions {
  headers: Record<string, string>;
  certificate?: string;
  key?: string;
  timeoutMs: number;
}

export type HttpGet = (url: URL, options: HttpGetOptions) => Promise<HttpResponse>;

export interface CredentialStoreDependencies {
  httpGet: HttpGet;
  sleep: (ms: number) => Promise<void>;
}

// Shape of a Credential Store binding in VCAP_SERVICES. Values are untrusted and validated before use.
interface RawCredentials {
  url?: unknown;
  username?: unknown;
  password?: unknown;
  certificate?: unknown;
  key?: unknown;
  oauth_token_url?: unknown;
  encryption?: { client_private_key?: unknown };
  parameters?: {
    authentication?: { type?: unknown };
    authorization?: { namespace_permissions?: unknown };
  };
}

export const httpsGet: HttpGet = (url, { headers, certificate, key, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        headers,
        ...(certificate !== undefined && { cert: certificate }),
        ...(key !== undefined && { key }),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            contentType: response.headers["content-type"],
            retryAfter: response.headers["retry-after"],
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    // Deadline for the whole request; the socket "timeout" option would only detect idle connections.
    const timer = setTimeout(() => {
      request.destroy(Object.assign(new Error(`request timed out after ${timeoutMs} ms`), { code: "ETIMEDOUT" }));
    }, timeoutMs);
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
    request.end();
  });

const defaultDependencies: CredentialStoreDependencies = {
  httpGet: httpsGet,
  sleep: (ms) => delay(ms),
};

export function isBtpCredentialStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[USE_BTP_CREDENTIAL_STORE_ENV]?.trim().toLowerCase() === "true";
}

/**
 * Reads all passwords from the namespaces of every bound SAP BTP Credential Store instance and writes them into the
 * environment, overriding values from the environment / .env file.
 * @returns the names of the secrets loaded from the Credential Store
 * @throws CredentialStoreError with a human readable message if no Credential Store is bound or loading fails
 */
export async function loadBtpCredentialStoreIntoEnv(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: CredentialStoreDependencies = defaultDependencies,
): Promise<Set<string>> {
  const bindings = parseCredentialStoreBindings(env.VCAP_SERVICES);
  const sources = bindings.flatMap((binding) => binding.namespaces.map((namespace) => `${binding.name}/${namespace}`));
  log.info(`Loading secrets from SAP BTP Credential Store namespaces: ${sources.join(", ")}`);

  const secrets = await loadCredentialStoreSecrets(bindings, dependencies);
  applySecretsToEnv(secrets, env);

  if (secrets.size === 0) {
    log.warn(`No secrets found in the bound SAP BTP Credential Store namespaces: ${sources.join(", ")}`);
  } else {
    log.info(`Loaded ${secrets.size} secret(s) from the SAP BTP Credential Store: ${[...secrets.keys()].join(", ")}`);
  }
  return new Set(secrets.keys());
}

/**
 * Extracts all Credential Store bindings from the VCAP_SERVICES environment variable.
 * @throws CredentialStoreError if VCAP_SERVICES is missing or invalid, or no usable Credential Store binding exists
 */
export function parseCredentialStoreBindings(vcapServices: string | undefined): CredentialStoreBinding[] {
  if (vcapServices === undefined || vcapServices.trim() === "") {
    throw new CredentialStoreError(
      `${USE_BTP_CREDENTIAL_STORE_ENV} is enabled, but the VCAP_SERVICES environment variable is not set. ` +
        "The SAP BTP Credential Store can only be used on Cloud Foundry with a bound Credential Store service instance. " +
        `Bind a Credential Store instance to this application (${BIND_EXAMPLE}) and restage it, ${DISABLE_HINT}.`,
    );
  }

  let services: unknown;
  try {
    services = JSON.parse(vcapServices);
  } catch {
    // The parser error is not included, as it can quote parts of VCAP_SERVICES, which contains credentials.
    throw new CredentialStoreError(
      `${USE_BTP_CREDENTIAL_STORE_ENV} is enabled, but the VCAP_SERVICES environment variable is not valid JSON.`,
    );
  }

  const entries = isRecord(services)
    ? Object.values(services)
        .flatMap((instances: unknown) => (Array.isArray(instances) ? (instances as unknown[]) : []))
        .filter(isCredentialStoreEntry)
    : [];

  if (entries.length === 0) {
    throw new CredentialStoreError(
      `${USE_BTP_CREDENTIAL_STORE_ENV} is enabled, but no SAP BTP Credential Store service instance ("${CREDSTORE_SERVICE_LABEL}") is bound to this application. ` +
        `Bind a Credential Store instance to this application (${BIND_EXAMPLE}) and restage it, ${DISABLE_HINT}.`,
    );
  }

  return entries.map(toBinding);
}

/**
 * Reads all passwords of all bound namespaces and merges them into one map.
 * Bindings and namespaces are processed in the order of VCAP_SERVICES; if a name exists more than once, the last one wins.
 */
export async function loadCredentialStoreSecrets(
  bindings: CredentialStoreBinding[],
  dependencies: CredentialStoreDependencies = defaultDependencies,
): Promise<Map<string, CredentialStoreSecret>> {
  const secrets = new Map<string, CredentialStoreSecret>();

  // Requests are sent one after another on purpose: the free and trial plans allow only 3 API calls per second.
  for (const binding of bindings) {
    for (const namespace of binding.namespaces) {
      const source = `${binding.name}/${namespace}`;

      for (const name of await listPasswordNames(binding, namespace, dependencies)) {
        const ignoreReason = getIgnoreReason(name);
        if (ignoreReason !== undefined) {
          log.warn(`Secret "${name}" in SAP BTP Credential Store namespace "${source}" is ignored: ${ignoreReason}`);
          continue;
        }

        const value = await readPassword(binding, namespace, name, dependencies);
        // An empty secret must not override a configured one, e.g. an empty WEBHOOK_SECRET disables signature checks.
        if (value.trim() === "") {
          log.warn(
            `Secret "${name}" in SAP BTP Credential Store namespace "${source}" has an empty value and is ignored.`,
          );
          continue;
        }
        const previous = secrets.get(name);
        if (previous !== undefined && previous.value !== value) {
          log.warn(
            `Secret "${name}" exists in multiple SAP BTP Credential Store namespaces with different values. ` +
              `The value from "${source}" overrides the one from "${previous.source}".`,
          );
        }
        secrets.set(name, { value, source });
      }
    }
  }

  return secrets;
}

/**
 * Writes the secrets into the environment (Credential Store values take precedence) and warns about values that are
 * also set in the environment / .env file.
 */
export function applySecretsToEnv(
  secrets: Map<string, CredentialStoreSecret>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const deprecation = isCloudFoundryEnvironment(env) ? ` ${ENV_SECRET_DEPRECATION}` : "";

  for (const [name, { value, source }] of secrets) {
    if (isSet(env[name])) {
      log.warn(
        `Secret "${name}" is set in the environment (.env file or process environment) and in the SAP BTP Credential Store ("${source}"). ` +
          `The Credential Store value is used. Remove "${name}" from the environment.${deprecation}`,
      );
    }
    env[name] = value;
  }
}

/**
 * On Cloud Foundry, warns about secrets that are read from the environment / .env file instead of the
 * SAP BTP Credential Store, as this is deprecated there. Outside of Cloud Foundry, secrets in the environment are fine.
 * @param credentialStoreSecrets names of the secrets that were loaded from the Credential Store
 */
export function warnAboutSecretsInEnvironment(
  credentialStoreSecrets: ReadonlySet<string>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isCloudFoundryEnvironment(env)) {
    return;
  }

  const hint = isBtpCredentialStoreEnabled(env)
    ? "Store it in the SAP BTP Credential Store instead."
    : `Store it in a bound SAP BTP Credential Store and set ${USE_BTP_CREDENTIAL_STORE_ENV}=true instead.`;

  for (const name of SECRET_ENV_VARIABLES) {
    if (!credentialStoreSecrets.has(name) && isSet(env[name])) {
      log.warn(
        `Secret "${name}" is read from the environment (.env file or process environment). ${hint} ${ENV_SECRET_DEPRECATION}`,
      );
    }
  }
}

/** Returns why a Credential Store password must not be written into the environment, if it must not */
function getIgnoreReason(name: string): string | undefined {
  // Environment variable names are case-insensitive on Windows
  const upperCaseName = name.toUpperCase();
  const isProtected =
    !UNPROTECTED_ENV_VARIABLES.includes(upperCaseName) &&
    (PROTECTED_ENV_VARIABLES.includes(upperCaseName) ||
      PROTECTED_ENV_PREFIXES.some((prefix) => upperCaseName.startsWith(prefix)));

  if (isProtected) {
    return `runtime and platform variables (${PROTECTED_ENV_DESCRIPTION}) cannot be set from the Credential Store.`;
  }
  if (name.includes("=") || name.includes("\0")) {
    return "the name is not a valid environment variable name.";
  }
  return undefined;
}

function isCredentialStoreEntry(entry: unknown): entry is Record<string, unknown> {
  return (
    isRecord(entry) &&
    (entry.label === CREDSTORE_SERVICE_LABEL ||
      (Array.isArray(entry.tags) && (entry.tags as unknown[]).includes(CREDSTORE_SERVICE_LABEL)))
  );
}

function toBinding(entry: Record<string, unknown>, index: number): CredentialStoreBinding {
  const name = asNonEmptyString(entry.name) ?? `#${index + 1}`;
  const prefix = `Credential Store binding "${name}"`;

  if (!isRecord(entry.credentials)) {
    throw new CredentialStoreError(`${prefix} has no credentials.`);
  }
  const credentials = entry.credentials as RawCredentials;

  return {
    name,
    url: parseUrl(credentials, prefix),
    auth: parseAuth(credentials, prefix),
    ...parseClientPrivateKey(credentials, prefix),
    namespaces: parseNamespaces(credentials, prefix),
  };
}

function parseUrl(credentials: RawCredentials, prefix: string): string {
  const url = asNonEmptyString(credentials.url)?.trim();
  if (url === undefined) {
    throw new CredentialStoreError(`${prefix} has no "url".`);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CredentialStoreError(`${prefix} has an invalid "url".`);
  }
  if (parsed.protocol !== "https:") {
    throw new CredentialStoreError(`${prefix} has a non-HTTPS "url"; refusing to send credentials over it.`);
  }

  return url.replace(/\/+$/, "");
}

function parseAuth(credentials: RawCredentials, prefix: string): CredentialStoreAuth {
  const certificate = asNonEmptyString(credentials.certificate);
  const key = asNonEmptyString(credentials.key);
  const username = asNonEmptyString(credentials.username);
  const password = asNonEmptyString(credentials.password);

  // mTLS bindings contain a "username" (the binding ID) as well, so the certificate is checked first.
  const type =
    asNonEmptyString(credentials.parameters?.authentication?.type) ??
    (certificate && key
      ? "mtls"
      : username && password
        ? "basic"
        : asNonEmptyString(credentials.oauth_token_url)
          ? "oauth"
          : undefined);

  switch (type) {
    case "mtls":
      if (certificate === undefined || key === undefined) {
        throw new CredentialStoreError(`${prefix} uses mTLS authentication, but has no "certificate" or "key".`);
      }
      return { type, certificate, key };
    case "basic":
      if (username === undefined || password === undefined) {
        throw new CredentialStoreError(`${prefix} uses basic authentication, but has no "username" or "password".`);
      }
      return { type, username, password };
    case undefined:
      throw new CredentialStoreError(
        `${prefix} contains neither mTLS ("certificate", "key") nor basic ("username", "password") credentials.`,
      );
    default:
      throw new CredentialStoreError(
        `${prefix} uses authentication type "${type}", which is not supported. ` +
          'Use a Credential Store instance with authentication type "mtls" (default) or "basic".',
      );
  }
}

function parseClientPrivateKey(credentials: RawCredentials, prefix: string): { clientPrivateKey?: KeyObject } {
  const clientPrivateKey = asNonEmptyString(credentials.encryption?.client_private_key);
  if (clientPrivateKey === undefined) {
    return {};
  }
  try {
    return { clientPrivateKey: parseRsaPrivateKey(clientPrivateKey) };
  } catch {
    throw new CredentialStoreError(`${prefix} has an invalid "encryption.client_private_key".`);
  }
}

function parseNamespaces(credentials: RawCredentials, prefix: string): string[] {
  const namespacePermissions = credentials.parameters?.authorization?.namespace_permissions;
  const namespaces = isRecord(namespacePermissions) ? Object.keys(namespacePermissions) : [];

  if (namespaces.length === 0) {
    throw new CredentialStoreError(
      `${prefix} has no namespaces bound. Recreate the binding with permissions for the namespaces to read the secrets from (${BIND_EXAMPLE}) and restage the application.`,
    );
  }
  return namespaces;
}

async function listPasswordNames(
  binding: CredentialStoreBinding,
  namespace: string,
  dependencies: CredentialStoreDependencies,
): Promise<string[]> {
  const action = "listing passwords";
  const names: string[] = [];

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const payload = await requestJson(
      binding,
      namespace,
      {
        path: `/passwords?page=${page}`,
        action,
        notFoundHint: "Make sure the namespace exists in the Credential Store instance.",
      },
      dependencies,
    );

    // The list endpoint returns a page of credential metadata ({ content: [...], last }); a plain array is accepted too.
    let items: unknown[];
    let isLastPage = true;
    if (Array.isArray(payload)) {
      items = payload as unknown[];
    } else if (isRecord(payload) && Array.isArray(payload.content)) {
      items = payload.content as unknown[];
      isLastPage = payload.last !== false;
    } else {
      throw new CredentialStoreError(`Received an unexpected payload ${describeContext(binding, namespace, action)}.`);
    }

    names.push(...items.flatMap((item) => (isRecord(item) && typeof item.name === "string" ? [item.name] : [])));
    if (isLastPage || items.length === 0) {
      return names;
    }
  }

  throw new CredentialStoreError(
    `Received more than ${MAX_LIST_PAGES} pages ${describeContext(binding, namespace, action)}.`,
  );
}

async function readPassword(
  binding: CredentialStoreBinding,
  namespace: string,
  name: string,
  dependencies: CredentialStoreDependencies,
): Promise<string> {
  const action = `reading password "${name}"`;
  const payload = await requestJson(
    binding,
    namespace,
    {
      path: `/password?name=${encodeURIComponent(name)}`,
      action,
      notFoundHint: "The password was listed, but could not be read; it might have been deleted or renamed meanwhile.",
    },
    dependencies,
  );

  if (!isRecord(payload) || typeof payload.value !== "string") {
    throw new CredentialStoreError(
      `Received a payload without "value" ${describeContext(binding, namespace, action)}.`,
    );
  }
  return payload.value;
}

interface CredentialStoreRequest {
  /** Path relative to the binding url, including the query */
  path: string;
  /** Describes the request in error messages, e.g. `listing passwords` */
  action: string;
  /** Hint added to the error message for HTTP 404 responses */
  notFoundHint: string;
}

async function requestJson(
  binding: CredentialStoreBinding,
  namespace: string,
  { path, action, notFoundHint }: CredentialStoreRequest,
  dependencies: CredentialStoreDependencies,
): Promise<unknown> {
  const context = describeContext(binding, namespace, action);
  const url = new URL(`${binding.url}${path}`);
  const headers: Record<string, string> = { [NAMESPACE_HEADER]: namespace, "Cache-Control": "no-cache" };
  if (binding.auth.type === "basic") {
    const token = Buffer.from(`${binding.auth.username}:${binding.auth.password}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }
  const clientCertificate =
    binding.auth.type === "mtls" ? { certificate: binding.auth.certificate, key: binding.auth.key } : {};

  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < MAX_RETRIES;
    let response: HttpResponse;
    try {
      response = await dependencies.httpGet(url, { headers, timeoutMs: REQUEST_TIMEOUT_MS, ...clientCertificate });
    } catch (error) {
      if (canRetry && isTransientError(error)) {
        const retryDelayMs = getRetryDelayMs(undefined, attempt);
        log.warn(
          `Request to the SAP BTP Credential Store failed ${context} (${errorMessage(error)}), retrying in ${retryDelayMs} ms`,
        );
        await dependencies.sleep(retryDelayMs);
        continue;
      }
      throw new CredentialStoreError(
        `Could not reach the SAP BTP Credential Store at ${binding.url} ${context}: ${errorMessage(error)}`,
      );
    }

    if (canRetry && TRANSIENT_STATUS_CODES.has(response.statusCode)) {
      const retryDelayMs = getRetryDelayMs(response.retryAfter, attempt);
      const message = `SAP BTP Credential Store responded with HTTP ${response.statusCode} ${context}, retrying in ${retryDelayMs} ms`;
      // Hitting the rate limit is expected on the free and trial plans (3 API calls per second)
      if (response.statusCode === 429) {
        log.info(message);
      } else {
        log.warn(message);
      }
      await dependencies.sleep(retryDelayMs);
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new CredentialStoreError(describeHttpError(response, context, notFoundHint));
    }

    return parsePayload(response, binding, context);
  }
}

function parsePayload(response: HttpResponse, binding: CredentialStoreBinding, context: string): unknown {
  let payload = response.body;

  if (isJose(response.contentType)) {
    if (binding.clientPrivateKey === undefined) {
      throw new CredentialStoreError(
        `Received an encrypted payload ${context}, but the binding has no "encryption.client_private_key" to decrypt it.`,
      );
    }
    try {
      payload = decryptJwe(payload, binding.clientPrivateKey);
    } catch (error) {
      throw new CredentialStoreError(`Could not decrypt the payload received ${context}: ${errorMessage(error)}`);
    }
  }

  try {
    return JSON.parse(payload) as unknown;
  } catch {
    // The parser error is not included, as it can quote parts of the payload, which contains secret values.
    throw new CredentialStoreError(`Received an invalid JSON payload ${context}.`);
  }
}

function describeHttpError(response: HttpResponse, context: string, notFoundHint: string): string {
  const base = `SAP BTP Credential Store responded with HTTP ${response.statusCode} ${context}.`;
  const body = response.body.trim();
  const detail =
    body !== "" && !isJose(response.contentType) ? ` Response: ${body.slice(0, MAX_ERROR_DETAIL_LENGTH)}` : "";

  switch (response.statusCode) {
    case 401:
      return `${base} The binding credentials were rejected; they might have expired (bindings are valid for 60 days by default). Rebind the Credential Store service and restage the application.${detail}`;
    case 403:
      return `${base} The binding is not allowed to access this namespace. Grant the "list" and "read" permissions for it in the binding's "namespace_permissions".${detail}`;
    case 404:
      return `${base} ${notFoundHint}${detail}`;
    case 429:
      return `${base} The rate limit of the Credential Store service plan is still exceeded after ${MAX_RETRIES} retries.${detail}`;
    default:
      return TRANSIENT_STATUS_CODES.has(response.statusCode)
        ? `${base} The Credential Store is still unavailable after ${MAX_RETRIES} retries.${detail}`
        : `${base}${detail}`;
  }
}

function isTransientError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return typeof code === "string" && TRANSIENT_ERROR_CODES.has(code);
}

function describeContext(binding: CredentialStoreBinding, namespace: string, action: string): string {
  return `while ${action} in namespace "${namespace}" of Credential Store binding "${binding.name}"`;
}

function getRetryDelayMs(retryAfter: string | undefined, attempt: number): number {
  // Retry-After can also be an HTTP date; only the seconds format is honored, otherwise back off linearly.
  const retryAfterSeconds = retryAfter !== undefined && retryAfter.trim() !== "" ? Number(retryAfter) : NaN;
  const delayMs =
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds * 1000 : 1000 * (attempt + 1);
  return Math.min(delayMs, MAX_RETRY_DELAY_MS);
}

function isJose(contentType: string | undefined): boolean {
  return contentType?.toLowerCase().includes("application/jose") ?? false;
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
