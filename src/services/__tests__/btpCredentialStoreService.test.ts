import { generateKeyPairSync, KeyObject } from "node:crypto";
import { AddressInfo, createServer, Socket } from "node:net";
import {
  CredentialStoreDependencies,
  HttpGet,
  httpsGet,
  HttpResponse,
  isBtpCredentialStoreEnabled,
  loadBtpCredentialStoreIntoEnv,
  parseCredentialStoreBindings,
  warnAboutSecretsInEnvironment,
} from "../btpCredentialStoreService.js";
import { CredentialStoreError } from "../../model/error/CredentialStoreError.js";
import { encryptJwe } from "../../__tests__/helpers/jwe.js";
import { log } from "../../util/logger.js";

jest.mock("../../util/logger.js", () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  },
}));

const CREDSTORE_URL = "https://credstore.mesh.cf.eu10.hana.ondemand.com/api/v1/credentials";
const CERTIFICATE = "-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----\n";
const CERTIFICATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nKEY\n-----END RSA PRIVATE KEY-----\n";

type Namespaces = Record<string, Record<string, string>>;

interface FakeCredentialStoreOptions {
  /** Encrypt responses with this key (payload encryption enabled) */
  encryptFor?: KeyObject;
  pageSize?: number;
  /** Fixed responses for requests whose URL contains the key */
  overrides?: Record<string, HttpResponse[]>;
}

function json(statusCode: number, body: unknown, extra: Partial<HttpResponse> = {}): HttpResponse {
  return { statusCode, contentType: "application/json", retryAfter: undefined, body: JSON.stringify(body), ...extra };
}

/** Emulates the Credential Store REST API (paginated list + read) for the given namespaces */
function fakeCredentialStore(namespaces: Namespaces, options: FakeCredentialStoreOptions = {}): jest.Mock {
  const { encryptFor, pageSize = 2, overrides = {} } = options;

  const respond = (body: unknown): HttpResponse =>
    encryptFor
      ? {
          statusCode: 200,
          contentType: "application/jose;charset=UTF-8",
          retryAfter: undefined,
          body: encryptJwe(JSON.stringify(body), encryptFor),
        }
      : json(200, body);

  const httpGet: HttpGet = (url, { headers }) => {
    const override = Object.entries(overrides).find(([match]) => url.href.includes(match))?.[1];
    if (override && override.length > 0) {
      return Promise.resolve(override.shift() as HttpResponse);
    }

    const namespace = headers["sapcp-credstore-namespace"] ?? "";
    const passwords = namespaces[namespace];
    if (!passwords) {
      return Promise.resolve(json(404, { message: "Namespace not found" }));
    }

    if (url.pathname.endsWith("/passwords")) {
      const page = Number(url.searchParams.get("page"));
      const names = Object.keys(passwords);
      const content = names.slice(page * pageSize, (page + 1) * pageSize).map((name) => ({ name, type: "password" }));
      return Promise.resolve(respond({ content, last: (page + 1) * pageSize >= names.length, number: page }));
    }

    const name = url.searchParams.get("name") ?? "";
    const value = passwords[name];
    return Promise.resolve(value === undefined ? json(404, {}) : respond({ name, value, username: "" }));
  };

  return jest.fn(httpGet);
}

function dependencies(httpGet: jest.Mock): CredentialStoreDependencies & { sleep: jest.Mock } {
  return { httpGet, sleep: jest.fn(() => Promise.resolve()) };
}

describe("btpCredentialStoreService", () => {
  let publicKey: KeyObject;
  let clientPrivateKey: string;

  beforeAll(() => {
    const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    publicKey = keyPair.publicKey;
    clientPrivateKey = keyPair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mtlsBinding(name: string, namespaces: string[], credentials: Record<string, unknown> = {}): unknown {
    return {
      label: "credstore",
      name,
      plan: "standard",
      tags: ["credstore", "securestore", "keystore", "credentials"],
      credentials: {
        url: CREDSTORE_URL,
        username: "0fcb3a97-binding-id",
        certificate: CERTIFICATE,
        key: CERTIFICATE_KEY,
        encryption: { client_private_key: clientPrivateKey, server_public_key: "MIIBIjAN" },
        parameters: {
          authentication: { type: "mtls" },
          authorization: {
            default_permissions: ["list"],
            namespace_permissions: Object.fromEntries(namespaces.map((namespace) => [namespace, ["list", "read"]])),
          },
        },
        ...credentials,
      },
    };
  }

  function basicBinding(name: string, namespaces: string[]): unknown {
    return {
      label: "credstore",
      name,
      credentials: {
        url: "https://credstore.cfapps.eu10.hana.ondemand.com/api/v1/credentials/",
        username: "binding-user",
        password: "binding-password",
        encryption: { client_private_key: clientPrivateKey },
        parameters: {
          authorization: {
            namespace_permissions: Object.fromEntries(namespaces.map((namespace) => [namespace, ["list", "read"]])),
          },
        },
      },
    };
  }

  function vcapServices(...credstore: unknown[]): string {
    return JSON.stringify({
      xsuaa: [{ label: "xsuaa", name: "my-xsuaa", credentials: {} }],
      ...(credstore.length > 0 && { credstore }),
    });
  }

  function loggedMessages(): string[] {
    return [log.info, log.warn, log.error, log.debug, log.fatal].flatMap((fn) =>
      (fn as jest.Mock).mock.calls.map((call: unknown[]) => call.map(String).join(" ")),
    );
  }

  async function expectLoadError(env: NodeJS.ProcessEnv, httpGet: jest.Mock, ...messageParts: string[]): Promise<void> {
    const error = await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CredentialStoreError);
    for (const part of messageParts) {
      expect((error as Error).message).toContain(part);
    }
  }

  describe("isBtpCredentialStoreEnabled", () => {
    it("should be disabled by default", () => {
      expect(isBtpCredentialStoreEnabled({})).toBe(false);
    });

    it.each(["true", "TRUE", " true "])("should be enabled for %p", (value) => {
      expect(isBtpCredentialStoreEnabled({ USE_BTP_CREDENTIAL_STORE: value })).toBe(true);
    });

    it.each(["false", "", "yes"])("should be disabled for %p", (value) => {
      expect(isBtpCredentialStoreEnabled({ USE_BTP_CREDENTIAL_STORE: value })).toBe(false);
    });
  });

  describe("parseCredentialStoreBindings", () => {
    it("should fail with a human readable message if VCAP_SERVICES is not set", () => {
      expect(() => parseCredentialStoreBindings(undefined)).toThrow(CredentialStoreError);
      expect(() => parseCredentialStoreBindings(undefined)).toThrow(
        /VCAP_SERVICES environment variable is not set.*cf bind-service.*USE_BTP_CREDENTIAL_STORE=false/,
      );
    });

    it("should fail without quoting VCAP_SERVICES if it is not valid JSON", () => {
      const invalid = '{"credstore": [{"credentials": {"password": "s3cr3t"';

      expect(() => parseCredentialStoreBindings(invalid)).toThrow(
        "VCAP_SERVICES environment variable is not valid JSON",
      );
      expect(() => parseCredentialStoreBindings(invalid)).not.toThrow(/s3cr3t/);
    });

    it("should fail with a human readable message if no Credential Store is bound", () => {
      expect(() => parseCredentialStoreBindings(vcapServices())).toThrow(
        /no SAP BTP Credential Store service instance \("credstore"\) is bound to this application/,
      );
    });

    it("should parse an mTLS binding", () => {
      const [binding] = parseCredentialStoreBindings(vcapServices(mtlsBinding("my-credstore", ["ns1", "ns2"])));

      expect(binding).toMatchObject({
        name: "my-credstore",
        url: CREDSTORE_URL,
        auth: { type: "mtls", certificate: CERTIFICATE, key: CERTIFICATE_KEY },
        namespaces: ["ns1", "ns2"],
      });
      expect(binding?.clientPrivateKey?.asymmetricKeyType).toBe("rsa");
    });

    it("should infer basic authentication and strip trailing slashes from the url", () => {
      const [binding] = parseCredentialStoreBindings(vcapServices(basicBinding("basic-credstore", ["ns1"])));

      expect(binding).toMatchObject({
        url: "https://credstore.cfapps.eu10.hana.ondemand.com/api/v1/credentials",
        auth: { type: "basic", username: "binding-user", password: "binding-password" },
      });
    });

    it("should trim whitespace from the url", () => {
      const binding = mtlsBinding("my-credstore", ["ns1"], { url: ` ${CREDSTORE_URL}/ \n` });

      expect(parseCredentialStoreBindings(vcapServices(binding))[0]?.url).toBe(CREDSTORE_URL);
    });

    it("should detect Credential Store bindings by tag, e.g. user-provided services", () => {
      const userProvided = { ...(mtlsBinding("ups-credstore", ["ns1"]) as object), label: "user-provided" };
      const vcap = JSON.stringify({ "user-provided": [userProvided] });

      expect(parseCredentialStoreBindings(vcap)).toHaveLength(1);
    });

    it("should return all bound Credential Store instances", () => {
      const vcap = vcapServices(mtlsBinding("first", ["ns1"]), basicBinding("second", ["ns2"]));

      expect(parseCredentialStoreBindings(vcap).map((binding) => binding.name)).toEqual(["first", "second"]);
    });

    it("should fail if the binding has no namespaces bound", () => {
      const binding = mtlsBinding("my-credstore", [], {
        parameters: { authorization: { default_permissions: ["read"] } },
      });

      expect(() => parseCredentialStoreBindings(vcapServices(binding))).toThrow(
        /Credential Store binding "my-credstore" has no namespaces bound.*namespace_permissions/,
      );
    });

    it.each(["oauth:mtls", "oauth:key"])("should reject the unsupported authentication type %s", (type) => {
      const binding = mtlsBinding("my-credstore", ["ns1"], {
        parameters: {
          authentication: { type },
          authorization: { namespace_permissions: { ns1: ["read"] } },
        },
      });

      expect(() => parseCredentialStoreBindings(vcapServices(binding))).toThrow(
        `uses authentication type "${type}", which is not supported`,
      );
    });

    it("should reject a binding without credentials for a supported authentication type", () => {
      const binding = mtlsBinding("my-credstore", ["ns1"], {
        certificate: undefined,
        key: undefined,
        parameters: { authorization: { namespace_permissions: { ns1: ["read"] } } },
      });

      expect(() => parseCredentialStoreBindings(vcapServices(binding))).toThrow(
        'contains neither mTLS ("certificate", "key") nor basic ("username", "password") credentials',
      );
    });

    it("should reject non HTTPS urls", () => {
      const binding = mtlsBinding("my-credstore", ["ns1"], { url: "http://credstore.example.com/api/v1/credentials" });

      expect(() => parseCredentialStoreBindings(vcapServices(binding))).toThrow('has a non-HTTPS "url"');
    });

    it("should reject an invalid client private key", () => {
      const binding = mtlsBinding("my-credstore", ["ns1"], { encryption: { client_private_key: "bm9wZQ==" } });

      expect(() => parseCredentialStoreBindings(vcapServices(binding))).toThrow(
        'has an invalid "encryption.client_private_key"',
      );
    });
  });

  describe("loadBtpCredentialStoreIntoEnv", () => {
    it("should merge the secrets of all bound namespaces into the environment", async () => {
      const env: NodeJS.ProcessEnv = {
        VCAP_SERVICES: vcapServices(mtlsBinding("first", ["ns1", "ns2"]), mtlsBinding("second", ["ns3"])),
        ORD_SOURCE_TYPE: "github",
      };
      const httpGet = fakeCredentialStore(
        {
          ns1: { GITHUB_TOKEN: "ghp_token", WEBHOOK_SECRET: "hook", BASIC_AUTH: '{"admin":"$2y$10$hash"}' },
          ns2: { CUSTOM_SECRET: "custom" },
          ns3: { OTHER_SECRET: "other" },
        },
        { encryptFor: publicKey },
      );

      await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet));

      expect(env).toEqual({
        VCAP_SERVICES: env.VCAP_SERVICES,
        ORD_SOURCE_TYPE: "github",
        GITHUB_TOKEN: "ghp_token",
        WEBHOOK_SECRET: "hook",
        BASIC_AUTH: '{"admin":"$2y$10$hash"}',
        CUSTOM_SECRET: "custom",
        OTHER_SECRET: "other",
      });
      expect(log.warn).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(
        "Loaded 5 secret(s) from the SAP BTP Credential Store: GITHUB_TOKEN, WEBHOOK_SECRET, BASIC_AUTH, CUSTOM_SECRET, OTHER_SECRET",
      );
    });

    it("should authenticate with the mTLS client certificate and send the namespace header", async () => {
      const env = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };
      const httpGet = fakeCredentialStore({ ns1: { GITHUB_TOKEN: "ghp_token" } }, { encryptFor: publicKey });

      await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet));

      const urls = httpGet.mock.calls.map(([url]: [URL]) => url.href);
      expect(urls).toEqual([`${CREDSTORE_URL}/passwords?page=0`, `${CREDSTORE_URL}/password?name=GITHUB_TOKEN`]);
      for (const [, options] of httpGet.mock.calls) {
        expect(options).toMatchObject({ certificate: CERTIFICATE, key: CERTIFICATE_KEY });
        expect(options.headers).toEqual({ "sapcp-credstore-namespace": "ns1", "Cache-Control": "no-cache" });
      }
    });

    it("should authenticate with basic authentication", async () => {
      const env = { VCAP_SERVICES: vcapServices(basicBinding("basic-credstore", ["ns1"])) };
      const httpGet = fakeCredentialStore({ ns1: { GITHUB_TOKEN: "ghp_token" } }, { encryptFor: publicKey });

      await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet));

      const [, options] = httpGet.mock.calls[0] as Parameters<HttpGet>;
      expect(options.headers.Authorization).toBe(
        `Basic ${Buffer.from("binding-user:binding-password").toString("base64")}`,
      );
      expect(options.certificate).toBeUndefined();
    });

    it("should read all pages of the password list", async () => {
      const passwords = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`SECRET_${i}`, `value-${i}`]));
      const env: NodeJS.ProcessEnv = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };
      const httpGet = fakeCredentialStore({ ns1: passwords }, { encryptFor: publicKey, pageSize: 2 });

      await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet));

      expect(Object.keys(env).filter((name) => name.startsWith("SECRET_"))).toHaveLength(5);
      expect(httpGet.mock.calls.filter(([url]: [URL]) => url.pathname.endsWith("/passwords"))).toHaveLength(3);
    });

    it("should support instances with payload encryption disabled", async () => {
      const env: NodeJS.ProcessEnv = {
        VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"], { encryption: undefined })),
      };
      const httpGet = fakeCredentialStore({ ns1: { GITHUB_TOKEN: "ghp_token" } });

      await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet));

      expect(env.GITHUB_TOKEN).toBe("ghp_token");
    });

    it("should let the last namespace win and warn if a secret exists in several namespaces with different values", async () => {
      const env: NodeJS.ProcessEnv = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1", "ns2"])) };
      const httpGet = fakeCredentialStore(
        { ns1: { GITHUB_TOKEN: "first", SAME: "same" }, ns2: { GITHUB_TOKEN: "second", SAME: "same" } },
        { encryptFor: publicKey },
      );

      await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet));

      expect(env.GITHUB_TOKEN).toBe("second");
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledWith(
        'Secret "GITHUB_TOKEN" exists in multiple SAP BTP Credential Store namespaces with different values. The value from "my-credstore/ns2" overrides the one from "my-credstore/ns1".',
      );
    });

    it("should override secrets from the environment / .env file and warn about the deprecation on Cloud Foundry", async () => {
      const env: NodeJS.ProcessEnv = {
        VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])),
        CF_INSTANCE_GUID: "instance-guid",
        GITHUB_TOKEN: "token-from-env-file",
      };
      const httpGet = fakeCredentialStore({ ns1: { GITHUB_TOKEN: "token-from-credstore" } }, { encryptFor: publicKey });

      await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet));

      expect(env.GITHUB_TOKEN).toBe("token-from-credstore");
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledWith(
        'Secret "GITHUB_TOKEN" is set in the environment (.env file or process environment) and in the SAP BTP Credential Store ("my-credstore/ns1"). ' +
          'The Credential Store value is used. Remove "GITHUB_TOKEN" from the environment. ' +
          "Providing secrets via environment variables or the .env file is deprecated on Cloud Foundry and will no longer be supported in an upcoming version.",
      );
    });

    it("should not mention the deprecation outside of Cloud Foundry", async () => {
      const env: NodeJS.ProcessEnv = {
        VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])),
        GITHUB_TOKEN: "token-from-env-file",
      };
      const httpGet = fakeCredentialStore({ ns1: { GITHUB_TOKEN: "token-from-credstore" } }, { encryptFor: publicKey });

      await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet));

      expect(env.GITHUB_TOKEN).toBe("token-from-credstore");
      expect(log.warn).toHaveBeenCalledWith(
        'Secret "GITHUB_TOKEN" is set in the environment (.env file or process environment) and in the SAP BTP Credential Store ("my-credstore/ns1"). ' +
          'The Credential Store value is used. Remove "GITHUB_TOKEN" from the environment.',
      );
    });

    it("should return the names of the loaded secrets", async () => {
      const env = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };
      const httpGet = fakeCredentialStore(
        { ns1: { GITHUB_TOKEN: "ghp_token", CF_MTLS_TRUSTED_CERTS: "{}" } },
        { encryptFor: publicKey },
      );

      await expect(loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet))).resolves.toEqual(
        new Set(["GITHUB_TOKEN", "CF_MTLS_TRUSTED_CERTS"]),
      );
    });

    it("should never log secret values", async () => {
      const env: NodeJS.ProcessEnv = {
        VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1", "ns2"])),
        CF_INSTANCE_GUID: "instance-guid",
        USE_BTP_CREDENTIAL_STORE: "true",
        GITHUB_TOKEN: "env-token-value",
        WEBHOOK_SECRET: "env-hook-value",
      };
      const httpGet = fakeCredentialStore(
        { ns1: { GITHUB_TOKEN: "credstore-value-1" }, ns2: { GITHUB_TOKEN: "credstore-value-2" } },
        { encryptFor: publicKey },
      );

      warnAboutSecretsInEnvironment(await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet)), env);

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Secret "WEBHOOK_SECRET" is read from'));
      const messages = loggedMessages().join("\n");
      expect(messages).toContain("GITHUB_TOKEN");
      for (const value of ["env-token-value", "env-hook-value", "credstore-value-1", "credstore-value-2"]) {
        expect(messages).not.toContain(value);
      }
    });

    it("should warn if the bound namespaces contain no secrets", async () => {
      const env = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };

      await loadBtpCredentialStoreIntoEnv(
        env,
        dependencies(fakeCredentialStore({ ns1: {} }, { encryptFor: publicKey })),
      );

      expect(log.warn).toHaveBeenCalledWith(
        "No secrets found in the bound SAP BTP Credential Store namespaces: my-credstore/ns1",
      );
    });

    it("should retry when the rate limit of the service plan is reached", async () => {
      const env: NodeJS.ProcessEnv = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };
      const httpGet = fakeCredentialStore(
        { ns1: { GITHUB_TOKEN: "ghp_token" } },
        {
          encryptFor: publicKey,
          overrides: { "password?name=": [json(429, {}, { retryAfter: "2" }), json(429, {})] },
        },
      );
      const deps = dependencies(httpGet);

      await loadBtpCredentialStoreIntoEnv(env, deps);

      expect(env.GITHUB_TOKEN).toBe("ghp_token");
      expect(deps.sleep.mock.calls).toEqual([[2000], [2000]]);
    });

    it("should give up when the rate limit is still exceeded after retrying", async () => {
      const env = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };
      const httpGet = fakeCredentialStore(
        { ns1: {} },
        { overrides: { "/passwords": Array.from({ length: 10 }, () => json(429, {})) } },
      );

      await expectLoadError(env, httpGet, "HTTP 429", "still exceeded after 5 retries");
      expect(httpGet).toHaveBeenCalledTimes(6);
    });

    it("should fail with a human readable message if the binding credentials are rejected", async () => {
      const env = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };
      const httpGet = fakeCredentialStore(
        {},
        { overrides: { "/passwords": [json(401, { message: "Unauthorized" })] } },
      );

      await expectLoadError(
        env,
        httpGet,
        'HTTP 401 while listing passwords in namespace "ns1" of Credential Store binding "my-credstore"',
        "might have expired",
        'Response: {"message":"Unauthorized"}',
      );
    });

    it("should fail with a human readable message if access to a namespace is denied", async () => {
      const env = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };
      const httpGet = fakeCredentialStore({}, { overrides: { "/passwords": [json(403, {})] } });

      await expectLoadError(env, httpGet, 'HTTP 403 while listing passwords in namespace "ns1"', '"list" and "read"');
    });

    it("should fail if a bound namespace does not exist", async () => {
      const env = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["missing"])) };

      await expectLoadError(env, fakeCredentialStore({}), "HTTP 404", "Make sure the namespace exists");
    });

    it("should fail if the Credential Store cannot be reached", async () => {
      const env = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };
      const httpGet = jest.fn(() => Promise.reject(new Error("getaddrinfo ENOTFOUND credstore")));

      await expectLoadError(
        env,
        httpGet,
        `Could not reach the SAP BTP Credential Store at ${CREDSTORE_URL}`,
        "ENOTFOUND",
      );
      // Errors that are not transient are not retried
      expect(httpGet).toHaveBeenCalledTimes(1);
    });

    it("should retry temporary outages and network errors", async () => {
      const env: NodeJS.ProcessEnv = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };
      const store = fakeCredentialStore({ ns1: { GITHUB_TOKEN: "ghp_token" } }, { encryptFor: publicKey });
      const httpGet = jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve(json(503, {})))
        .mockImplementationOnce(() =>
          Promise.reject(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })),
        )
        .mockImplementation(store);
      const deps = dependencies(httpGet);

      await loadBtpCredentialStoreIntoEnv(env, deps);

      expect(env.GITHUB_TOKEN).toBe("ghp_token");
      expect(deps.sleep.mock.calls).toEqual([[1000], [2000]]);
    });

    it("should give up when the Credential Store is still unavailable after retrying", async () => {
      const env = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };
      const httpGet = jest.fn(() => Promise.resolve(json(503, {})));

      await expectLoadError(env, httpGet, "HTTP 503", "still unavailable after 5 retries");
      expect(httpGet).toHaveBeenCalledTimes(6);
    });

    it("should explain a missing password differently than a missing namespace", async () => {
      const env = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };
      const httpGet = fakeCredentialStore(
        { ns1: { GITHUB_TOKEN: "ghp_token" } },
        { encryptFor: publicKey, overrides: { "password?name=": [json(404, {})] } },
      );

      const error = await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet)).catch((e: unknown) => e);

      expect((error as Error).message).toContain('HTTP 404 while reading password "GITHUB_TOKEN"');
      expect((error as Error).message).toContain("might have been deleted or renamed");
      expect((error as Error).message).not.toContain("Make sure the namespace exists");
    });

    it("should ignore secrets with an empty value instead of overriding the environment", async () => {
      const env: NodeJS.ProcessEnv = {
        VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])),
        WEBHOOK_SECRET: "hook-from-env",
      };
      const httpGet = fakeCredentialStore({ ns1: { WEBHOOK_SECRET: " " } }, { encryptFor: publicKey });

      await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet));

      expect(env.WEBHOOK_SECRET).toBe("hook-from-env");
      expect(log.warn).toHaveBeenCalledWith(
        'Secret "WEBHOOK_SECRET" in SAP BTP Credential Store namespace "my-credstore/ns1" has an empty value and is ignored.',
      );
    });

    it("should not set runtime and platform variables, but the mTLS configuration and other configuration", async () => {
      const vcap = vcapServices(mtlsBinding("my-credstore", ["ns1"]));
      const env: NodeJS.ProcessEnv = { VCAP_SERVICES: vcap };
      const mtlsConfig = '{"certs":[{"issuer":"*","subject":"CN=my-service"}],"rootCaDn":["CN=Root CA"]}';
      const httpGet = fakeCredentialStore(
        {
          ns1: {
            "NODE_TLS_REJECT_UNAUTHORIZED": "0",
            "node_options": "--require ./evil.js",
            "VCAP_SERVICES": "{}",
            "CF_INSTANCE_GUID": "fake-guid",
            "USE_BTP_CREDENTIAL_STORE": "false",
            "A=B": "not settable",
            "CF_MTLS_TRUSTED_CERTS": mtlsConfig,
            "ORD_AUTH_TYPE": "cf-mtls",
          },
        },
        { encryptFor: publicKey, pageSize: 10 },
      );

      await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet));

      expect(env).toEqual({ VCAP_SERVICES: vcap, CF_MTLS_TRUSTED_CERTS: mtlsConfig, ORD_AUTH_TYPE: "cf-mtls" });
      // The values of ignored passwords are not even requested
      const readNames = httpGet.mock.calls.flatMap(([url]: [URL]) => url.searchParams.getAll("name"));
      expect(readNames).toEqual(["CF_MTLS_TRUSTED_CERTS", "ORD_AUTH_TYPE"]);
      expect(log.warn).toHaveBeenCalledTimes(6);
      expect(log.warn).toHaveBeenCalledWith(
        'Secret "NODE_TLS_REJECT_UNAUTHORIZED" in SAP BTP Credential Store namespace "my-credstore/ns1" is ignored: runtime and platform variables (NODE_*, VCAP_*, CF_*, USE_BTP_CREDENTIAL_STORE) cannot be set from the Credential Store.',
      );
      expect(log.warn).toHaveBeenCalledWith(
        'Secret "A=B" in SAP BTP Credential Store namespace "my-credstore/ns1" is ignored: the name is not a valid environment variable name.',
      );
    });

    it("should fail if an encrypted payload is received, but the binding has no client private key", async () => {
      const env = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"], { encryption: undefined })) };
      const httpGet = fakeCredentialStore({ ns1: { GITHUB_TOKEN: "ghp_token" } }, { encryptFor: publicKey });

      await expectLoadError(env, httpGet, 'has no "encryption.client_private_key" to decrypt it');
    });

    it("should fail without quoting the payload if it is not valid JSON", async () => {
      const env = { VCAP_SERVICES: vcapServices(mtlsBinding("my-credstore", ["ns1"])) };
      const httpGet = fakeCredentialStore(
        { ns1: { GITHUB_TOKEN: "ghp_token" } },
        {
          overrides: {
            "password?name=": [
              { statusCode: 200, contentType: "application/json", retryAfter: undefined, body: '{"value": "ghp_tok' },
            ],
          },
        },
      );

      const error = await loadBtpCredentialStoreIntoEnv(env, dependencies(httpGet)).catch((e: unknown) => e);

      expect((error as Error).message).toBe(
        'Received an invalid JSON payload while reading password "GITHUB_TOKEN" in namespace "ns1" of Credential Store binding "my-credstore".',
      );
    });

    it("should fail if VCAP_SERVICES contains no Credential Store binding", async () => {
      await expectLoadError({ VCAP_SERVICES: vcapServices() }, fakeCredentialStore({}), "no SAP BTP Credential Store");
    });
  });

  describe("warnAboutSecretsInEnvironment", () => {
    const deprecation =
      "Providing secrets via environment variables or the .env file is deprecated on Cloud Foundry and will no longer be supported in an upcoming version.";

    it("should warn about secrets in the environment on Cloud Foundry, even with the Credential Store disabled", () => {
      const env = { CF_INSTANCE_GUID: "instance-guid", GITHUB_TOKEN: "ghp_token", BASIC_AUTH: " " };

      warnAboutSecretsInEnvironment(new Set(), env);

      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledWith(
        'Secret "GITHUB_TOKEN" is read from the environment (.env file or process environment). ' +
          `Store it in a bound SAP BTP Credential Store and set USE_BTP_CREDENTIAL_STORE=true instead. ${deprecation}`,
      );
    });

    it("should only warn about secrets that were not loaded from the Credential Store", () => {
      const env = {
        CF_INSTANCE_GUID: "instance-guid",
        USE_BTP_CREDENTIAL_STORE: "true",
        GITHUB_TOKEN: "from-credstore",
        WEBHOOK_SECRET: "from-env",
      };

      warnAboutSecretsInEnvironment(new Set(["GITHUB_TOKEN"]), env);

      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledWith(
        'Secret "WEBHOOK_SECRET" is read from the environment (.env file or process environment). ' +
          `Store it in the SAP BTP Credential Store instead. ${deprecation}`,
      );
    });

    it("should not warn outside of Cloud Foundry", () => {
      warnAboutSecretsInEnvironment(new Set(), {
        GITHUB_TOKEN: "ghp_token",
        WEBHOOK_SECRET: "hook",
        BASIC_AUTH: "{}",
        CF_INSTANCE_GUID: "",
      });

      expect(log.warn).not.toHaveBeenCalled();
    });

    it("should not warn about non-secret configuration", () => {
      warnAboutSecretsInEnvironment(new Set(), { CF_INSTANCE_GUID: "instance-guid", CF_MTLS_TRUSTED_CERTS: "{}" });

      expect(log.warn).not.toHaveBeenCalled();
    });
  });

  describe("httpsGet", () => {
    it("should abort a request that does not complete within the timeout", async () => {
      // Accepts connections but never answers the TLS handshake
      const sockets = new Set<Socket>();
      const server = createServer((socket) => sockets.add(socket));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;

      try {
        await expect(
          httpsGet(new URL(`https://127.0.0.1:${port}/`), { headers: {}, timeoutMs: 200 }),
        ).rejects.toMatchObject({ message: "request timed out after 200 ms", code: "ETIMEDOUT" });
      } finally {
        sockets.forEach((socket) => socket.destroy());
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});
