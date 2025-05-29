import { ordConfigurationSchema, type ORDDocument } from "@open-resource-discovery/specification";
import fs from "fs";
import path from "path";
import { CommandLineOptions, OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { buildProviderServerOptions, ProviderServerOptions } from "src/model/server.js";
import { joinFilePaths } from "../util/pathUtils.js";
import { BackendError } from "../model/error/BackendError.js";
import { GitHubDirectoryInvalidError } from "../model/error/GithubErrors.js";
import { LocalDirectoryError } from "../model/error/OrdDirectoryError.js";
import { ValidationError } from "../model/error/ValidationError.js";
import { GitHubInstance } from "../model/github.js";
import { fetchGitHubFile, getGithubDirectoryContents } from "./github.js";
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

export async function validateAndParseOptions(options: CommandLineOptions): Promise<ProviderServerOptions> {
  const errors: string[] = [];

  validateBaseUrlOption(options, errors);

  validateAuthOptions(options.auth, errors, options);

  validateSourceTypeOptionsOffline(options, errors);

  if (errors.length > 0) {
    throw ValidationError.fromErrors(errors);
  }

  const parsedOpts = await buildProviderServerOptions(options);

  if (parsedOpts.sourceType === OptSourceType.Github) {
    await validateSourceTypeOptionsOnline(parsedOpts, errors);
  }

  // Check for errors after online validation
  if (errors.length > 0) {
    throw ValidationError.fromErrors(errors);
  }

  return parsedOpts;
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

      if (!trustedIssuers && !trustedSubjects && !configEndpoints) {
        errors.push(
          "SAP CF mTLS mode requires at least one of MTLS_TRUSTED_ISSUERS, MTLS_TRUSTED_SUBJECTS, or MTLS_CONFIG_ENDPOINTS to be configured",
        );
      } else if (trustedIssuers && trustedIssuers.trim() === "") {
        errors.push("MTLS_TRUSTED_ISSUERS cannot be empty when configured");
      } else if (trustedSubjects && trustedSubjects.trim() === "") {
        errors.push("MTLS_TRUSTED_SUBJECTS cannot be empty when configured");
      } else if (configEndpoints && configEndpoints.trim() === "") {
        errors.push("MTLS_CONFIG_ENDPOINTS cannot be empty when configured");
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

function validateLocalDirectory(directoryPath: string, documentsSubDirectory: string = "documents"): void {
  // Resolve the path to get absolute path, handling both relative and absolute paths
  const absolutePath = path.resolve(directoryPath);
  try {
    // Check if the main directory exists
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

    // Check for documents subdirectory
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

    // Check for at least one file in the documents directory
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

    // Check if at least one valid ORD document exists
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
    log.error(
      `Local directory validation failed for ${directoryPath}: ${errorMessage}`,
      error instanceof Error ? error : undefined,
    );
    if (error instanceof LocalDirectoryError) {
      throw error;
    }
    throw LocalDirectoryError.forPath(directoryPath, `Unexpected error during validation: ${errorMessage}`);
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

export function trimLeadingAndTrailingSlashes(str: string | undefined): string | undefined {
  if (str === undefined) return undefined;
  return str.replace(/^\/|\/$/g, "");
}

export function trimTrailingSlash(str: string | undefined): string | undefined {
  if (str === undefined) return undefined;
  return str.replace(/\/$/, "");
}

async function validateSourceTypeOptionsOnline(options: ProviderServerOptions, errors: string[]): Promise<void> {
  const githubApiUrl = options.githubApiUrl!;
  const githubRepository = options.githubRepository!;
  const githubBranch = options.githubBranch!;
  const githubToken = options.githubToken!;

  // Checks should have already ensured these are non-null
  // Perform GitHub access and directory structure check
  const fullGitHubPath = joinFilePaths(options.ordDirectory, options.ordDocumentsSubDirectory);

  try {
    log.info(`Checking GitHub path: ${githubApiUrl}/${githubRepository}/tree/${githubBranch}/${fullGitHubPath}`);
    await validateGithubDirectoryContents(
      fullGitHubPath,
      {
        host: githubApiUrl,
        repo: githubRepository,
        branch: githubBranch,
      },
      githubToken,
    );
    log.info(`GitHub path validation successful for: ${fullGitHubPath}`);
  } catch (error: unknown) {
    let message: string;
    if (error instanceof BackendError) {
      message = error.message;
    } else if (error instanceof Error) {
      message = `An unexpected error occurred during GitHub validation: ${error.message}`;
    } else {
      message = `An unexpected error occurred during GitHub validation: ${String(error)}`;
    }
    errors.push(message);
  }
}

async function validateGithubDirectoryContents(
  githubPath: string,
  githubInstance: GitHubInstance,
  githubToken: string,
): Promise<void> {
  log.debug(`Validating GitHub directory contents for path: ${githubPath}...`);
  const directoryItems = await getGithubDirectoryContents(githubInstance, githubPath, githubToken);
  const filesInDir = directoryItems.filter((item) => item.type === "file").map((item) => item.path);

  log.debug(`Found ${filesInDir.length} file(s) in GitHub directory.`);

  // Check if there is at least one valid JSON document
  let hasValidOrdDocument = false;
  const jsonFiles = filesInDir.filter((file) => file.endsWith(".json"));

  if (jsonFiles.length === 0) {
    const errMsg = `No JSON files found in directory: ${githubPath}`;
    log.warn(errMsg);
    throw GitHubDirectoryInvalidError.forPath(githubPath, new Error(errMsg));
  }

  log.debug(`Found ${jsonFiles.length} JSON file(s). Validating ORD content...`);

  for (const filePath of jsonFiles) {
    log.debug(`Fetching content for GitHub file: ${filePath}`);
    try {
      const fileContents = await fetchGitHubFile(githubInstance, filePath, githubToken);
      const parsedFile = JSON.parse(fileContents);

      log.debug(`Validating ORD document structure for: ${filePath}`);
      validateOrdDocument(parsedFile as ORDDocument);
      hasValidOrdDocument = true;
      break;
    } catch (err) {
      log.warn(`Validation failed for GitHub file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!hasValidOrdDocument) {
    const errMsg = `No valid ORD documents found in directory: ${githubPath}`;
    throw GitHubDirectoryInvalidError.forPath(githubPath, new Error(errMsg));
  }
}
