import { ordConfigurationSchema, type ORDDocument } from "@open-resource-discovery/specification";
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
import { MtlsMode } from "../constant.js";

// @ts-expect-error baseUrl pattern selection
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
export async function validateOffline(options: CommandLineOptions): Promise<ValidationResult> {
  const errors: string[] = [];

  validateBaseUrlOption(options, errors);

  validateAuthOptions(options.auth, errors, options);

  validateSourceTypeOptionsOffline(options, errors);

  if (errors.length > 0) {
    throw ValidationError.fromErrors(errors);
  }

  const parsedOpts = await buildProviderServerOptions(options);

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
        const document = JSON.parse(contents) as ORDDocument;
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Local directory validation failed for ${directoryPath}: ${errorMessage}`);
    if (error instanceof LocalDirectoryError) {
      throw error;
    }
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

function validateAuthOptions(authMethods: OptAuthMethod[], errors: string[], options?: CommandLineOptions): void {
  const isOpen = authMethods.includes(OptAuthMethod.Open);
  const isBasicAuth = authMethods.includes(OptAuthMethod.Basic);
  const isMtls = authMethods.includes(OptAuthMethod.MTLS);

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

  // Validate mTLS options if mTLS is enabled and options are provided
  if (isMtls && options) {
    // Check if SAP CF mode is enabled
    const mtlsMode = process.env.MTLS_MODE || MtlsMode.Standard;

    if (mtlsMode === MtlsMode.SapCmpMtls) {
      // In SAP CF mode, certificate files are not required but we need trusted issuers or subjects
      log.info("SAP CF mTLS mode detected - certificate files not required");

      const trustedIssuers = process.env.MTLS_TRUSTED_ISSUERS;
      const trustedSubjects = process.env.MTLS_TRUSTED_SUBJECTS;
      const configEndpoints = process.env.MTLS_CONFIG_ENDPOINTS;

      // MTLS_CONFIG_ENDPOINTS is mandatory in sap:cmp-mtls mode
      if (!configEndpoints || configEndpoints.trim() === "") {
        errors.push("SAP CF mTLS mode requires MTLS_CONFIG_ENDPOINTS to be configured");
      }

      // Validate optional trusted issuers and subjects if provided
      if (trustedIssuers && trustedIssuers.trim() === "") {
        errors.push("MTLS_TRUSTED_ISSUERS cannot be empty when configured");
      }
      if (trustedSubjects && trustedSubjects.trim() === "") {
        errors.push("MTLS_TRUSTED_SUBJECTS cannot be empty when configured");
      }
    } else {
      // Standard mTLS mode requires certificate files
      const missingParams: string[] = [];
      if (!options.mtlsCaPath) missingParams.push("--mtls-ca-path");
      if (!options.mtlsCertPath) missingParams.push("--mtls-cert-path");
      if (!options.mtlsKeyPath) missingParams.push("--mtls-key-path");

      if (missingParams.length > 0) {
        errors.push(`Detected missing parameters for mTLS authentication: ${missingParams.join(", ")}`);
        return;
      }

      // Validate file existence
      if (options.mtlsCaPath && !fs.existsSync(options.mtlsCaPath)) {
        errors.push(`CA certificate file not found: ${options.mtlsCaPath}`);
      }
      if (options.mtlsCertPath && !fs.existsSync(options.mtlsCertPath)) {
        errors.push(`Server certificate file not found: ${options.mtlsCertPath}`);
      }
      if (options.mtlsKeyPath && !fs.existsSync(options.mtlsKeyPath)) {
        errors.push(`Server private key file not found: ${options.mtlsKeyPath}`);
      }
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
