import { ordConfigurationSchema, type OrdDocument } from "@open-resource-discovery/specification";
import fs from "fs";
import path from "path";
import { CommandLineOptions, OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { buildProviderServerOptions, ProviderServerOptions } from "src/model/server.js";
import { joinFilePaths } from "../util/pathUtils.js";
import { LocalDirectoryError } from "../model/error/OrdDirectoryError.js";
import { ValidationError } from "../model/error/ValidationError.js";
import { log } from "./logger.js";
import { validateOrdDocument } from "./validateOrdDocument.js";
import { isBcryptHash } from "./passwordHash.js";
import { getBaseUrl } from "./ordConfig.js";

export const ordBaseUrlPattern = new RegExp(ordConfigurationSchema.properties["baseUrl"]["pattern"]);

interface BasicAuthUsers {
  [key: string]: string;
}

export interface ValidationResult {
  options: ProviderServerOptions;
  needsOnlineValidation: boolean;
}

/**
 * Validates command line options offline (without network access)
 * @param options Command line options to validate
 * @returns Validation result with parsed options
 * @throws ValidationError if validation fails
 */
export function validateOffline(options: CommandLineOptions): ValidationResult {
  const errors: string[] = [];

  validateBaseUrlOption(options, errors);
  validateAuthOptions(options.auth, errors);
  validateSourceTypeOptionsOffline(options, errors);

  if (errors.length > 0) {
    throw ValidationError.fromErrors(errors);
  }

  const parsedOpts = buildProviderServerOptions(options);

  return {
    options: parsedOpts,
    needsOnlineValidation: parsedOpts.sourceType === OptSourceType.Github,
  };
}

/**
 * Validates a local directory contains valid ORD documents
 * @param directoryPath Path to the directory to validate
 * @param documentsSubDirectory Subdirectory name containing ORD documents
 * @throws LocalDirectoryError if validation fails
 */
export function validateLocalDirectory(directoryPath: string, documentsSubDirectory: string = "documents"): void {
  const absolutePath = path.resolve(directoryPath);
  try {
    try {
      const dirStat = fs.statSync(absolutePath);
      if (!dirStat.isDirectory()) {
        throw LocalDirectoryError.forPath(directoryPath, `Specified path is not a directory: ${absolutePath}`);
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        throw LocalDirectoryError.forPath(directoryPath, `Directory not found: ${absolutePath}`);
      }
      throw error;
    }

    const documentsPath = joinFilePaths(absolutePath, documentsSubDirectory);
    try {
      const docStat = fs.statSync(documentsPath);
      if (!docStat.isDirectory()) {
        throw LocalDirectoryError.forPath(
          directoryPath,
          `'${documentsSubDirectory}' folder is not a directory: ${documentsPath}`,
        );
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        throw LocalDirectoryError.forPath(
          directoryPath,
          `'${documentsSubDirectory}' folder not found in directory: ${absolutePath}`,
        );
      }
      throw error;
    }

    const files = fs.readdirSync(documentsPath, { recursive: true }) as string[];
    const hasFiles = files.some((file) => {
      const filePath = joinFilePaths(documentsPath, file);
      try {
        return fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    });

    if (!hasFiles) {
      throw LocalDirectoryError.forPath(
        directoryPath,
        `'${documentsSubDirectory}' folder is empty - at least one file is required: ${documentsPath}`,
      );
    }

    let hasValidOrdDocument = false;

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = joinFilePaths(documentsPath, file);
      try {
        if (!fs.statSync(filePath).isFile()) continue;

        const contents = fs.readFileSync(filePath).toString();
        const document = JSON.parse(contents) as OrdDocument;
        validateOrdDocument(document);
        hasValidOrdDocument = true;
        break;
      } catch (err) {
        log.warn(`Validation failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!hasValidOrdDocument) {
      throw LocalDirectoryError.forPath(
        directoryPath,
        `No valid ORD document found in '${documentsSubDirectory}' folder: ${documentsPath}`,
      );
    }
  } catch (error) {
    if (error instanceof LocalDirectoryError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw LocalDirectoryError.forPath(directoryPath, `Unexpected error during validation: ${errorMessage}`);
  }
}

function validateBaseUrlOption(options: CommandLineOptions, errors: string[]): void {
  if (!options.baseUrl) {
    errors.push("Detected missing baseUrl parameter.");
    return;
  }

  const baseUrlFixed = getBaseUrl(options.baseUrl);

  if (!ordBaseUrlPattern.test(baseUrlFixed)) {
    errors.push(`Detected invalid baseUrl: ${options.baseUrl}`);
  }
}

function validateAuthOptions(authMethods: OptAuthMethod[], errors: string[]): void {
  const isOpen = authMethods.includes(OptAuthMethod.Open);
  const isBasicAuth = authMethods.includes(OptAuthMethod.Basic);
  const isMtls = authMethods.includes(OptAuthMethod.CfMtls);

  if (isOpen && (isBasicAuth || isMtls)) {
    errors.push('Authentication method "open" cannot be used together with other options.');
    return;
  }

  if (!isOpen && !isBasicAuth && !isMtls) {
    errors.push("No valid authentication method specified.");
    return;
  }

  if (isBasicAuth) {
    try {
      const basicAuthUsers = process.env.BASIC_AUTH ? JSON.parse(process.env.BASIC_AUTH) : null;

      if (!isValidBasicAuthUsers(basicAuthUsers)) {
        errors.push(
          'Environment variable "BASIC_AUTH" must be a JSON object with string keys and bcrypt hashes as value.',
        );
        return;
      }

      if (Object.keys(basicAuthUsers).length === 0) {
        errors.push('Environment variable "BASIC_AUTH" cannot be empty when basic auth is enabled.');
      }
    } catch (error) {
      errors.push(
        `Invalid JSON in environment variable "BASIC_AUTH": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (isMtls) {
    const trustedCerts = process.env.CF_MTLS_TRUSTED_CERTS;

    if (!trustedCerts || trustedCerts.trim() === "") {
      errors.push("SAP BTP (CloudFoundry runtime) authentication requires CF_MTLS_TRUSTED_CERTS to be configured.");
      return;
    }

    // We should fail if cf-mtls is active AND the CF_INSTANCE_GUID is missing, as this auth method is specific to CF
    const cfInstanceGuid = process.env.CF_INSTANCE_GUID;
    if (!cfInstanceGuid || cfInstanceGuid.trim() === "") {
      errors.push("CF mTLS authentication requires CF_INSTANCE_GUID environment variable to be set.");
      return;
    }

    // Validate CF_MTLS_TRUSTED_CERTS JSON structure
    try {
      const parsed = JSON.parse(trustedCerts) as {
        certs: { issuer: string; subject: string }[];
        rootCaDn: string[];
        configEndpoints?: string[];
      };

      if (!parsed || typeof parsed !== "object") {
        errors.push("CF_MTLS_TRUSTED_CERTS must be a JSON object");
        return;
      }

      if (!Array.isArray(parsed.certs)) {
        errors.push("CF_MTLS_TRUSTED_CERTS.certs must be an array");
        return;
      }

      if (!Array.isArray(parsed.rootCaDn)) {
        errors.push("CF_MTLS_TRUSTED_CERTS.rootCaDn must be an array");
        return;
      }

      const hasConfigEndpoints = parsed.configEndpoints && parsed.configEndpoints.length > 0;
      if (parsed.certs.length === 0 && parsed.rootCaDn.length === 0 && !hasConfigEndpoints) {
        errors.push("CF_MTLS_TRUSTED_CERTS must contain at least one certificate pair, root CA DN, or config endpoint");
        return;
      }

      for (const cert of parsed.certs) {
        if (!cert.issuer || typeof cert.issuer !== "string") {
          errors.push("Each cert entry in CF_MTLS_TRUSTED_CERTS must have a valid 'issuer' string");
          return;
        }
        if (!cert.subject || typeof cert.subject !== "string") {
          errors.push("Each cert entry in CF_MTLS_TRUSTED_CERTS must have a valid 'subject' string");
          return;
        }
      }

      for (const dn of parsed.rootCaDn) {
        if (typeof dn !== "string") {
          errors.push("Each rootCaDn entry in CF_MTLS_TRUSTED_CERTS must be a string");
          return;
        }
      }

      // Validate configEndpoints if present
      if (parsed.configEndpoints !== undefined) {
        if (!Array.isArray(parsed.configEndpoints)) {
          errors.push("CF_MTLS_TRUSTED_CERTS.configEndpoints must be an array");
          return;
        }
        for (const endpoint of parsed.configEndpoints) {
          if (typeof endpoint !== "string" || endpoint.trim() === "") {
            errors.push("Each configEndpoint in CF_MTLS_TRUSTED_CERTS must be a non-empty string");
            return;
          }
        }
      }
    } catch (error) {
      errors.push(`Invalid JSON in CF_MTLS_TRUSTED_CERTS: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function validateSourceTypeOptionsOffline(options: CommandLineOptions, errors: string[]): void {
  const missingParams: string[] = [];

  switch (options.sourceType) {
    case OptSourceType.Local:
      if (!options.directory) {
        errors.push('--directory (-d) is required when --source-type is "local"');
      } else {
        try {
          validateLocalDirectory(options.directory, options.documentsSubdirectory);
        } catch (error: unknown) {
          errors.push(error instanceof LocalDirectoryError ? error.message : String(error));
        }
      }
      break;
    case OptSourceType.Github:
      if (!options.githubApiUrl) missingParams.push("--github-api-url");
      if (!options.githubRepository) missingParams.push("--github-repository");
      if (!options.githubBranch) missingParams.push("--github-branch");
      if (!options.githubToken) missingParams.push("--github-token");

      if (missingParams.length > 0) {
        errors.push(`Detected missing parameters for github source type: ${missingParams.join(", ")}`);
      }
      break;
    default:
      errors.push(`Invalid source type. Allowed options: ${Object.values(OptSourceType).join(", ")}`);
  }
}

function isValidBasicAuthUsers(value: unknown): value is BasicAuthUsers {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([key, val]) => typeof key === "string" && typeof val === "string" && isBcryptHash(val),
  );
}
