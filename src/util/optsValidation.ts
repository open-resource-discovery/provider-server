import { ordConfigurationSchema, type ORDDocument } from "@open-resource-discovery/specification";
import fs from "fs";
import path from "path";
import { CommandLineOptions, OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { buildProviderServerOptions, ProviderServerOptions } from "src/model/server.js";
import { PATH_CONSTANTS } from "../constant.js";
import { joinFilePaths, normalizePath } from "../util/pathUtils.js";
import { BackendError } from "../model/error/BackendError.js";
import { GitHubDirectoryInvalidError } from "../model/error/GithubErrors.js";
import { LocalDirectoryError } from "../model/error/OrdDirectoryError.js";
import { ValidationError } from "../model/error/ValidationError.js";
import { GitHubFileResponse, GitHubInstance } from "../model/github.js";
import { fetchGitHubFile, getGithubDirectoryContents } from "./github.js";
import { log } from "./logger.js";
import { validateOrdDocument } from "./validateOrdDocument.js";
import { isBcryptHash } from "./passwordHash.js";

// @ts-expect-error baseUrl pattern selection
export const ordBaseUrlPattern = new RegExp(ordConfigurationSchema.properties["baseUrl"]["pattern"]);

interface BasicAuthUsers {
  [key: string]: string;
}
export async function validateAndParseOptions(options: CommandLineOptions): Promise<ProviderServerOptions> {
  const errors: string[] = [];

  // Validate source type specific options
  await validateSourceTypeOptions(options, errors);

  // Validate authentication options
  await validateAuthOptions(options.auth, errors);

  // Validate baseUrl
  validateBaseUrlOption(options, errors);

  if (errors.length > 0) {
    throw ValidationError.fromErrors(errors);
  }

  return buildProviderServerOptions(options);
}

function validateBaseUrlOption(options: CommandLineOptions, errors: string[]): void {
  if (!options.baseUrl) {
    errors.push("Detected missing baseUrl parameter.");
    return;
  }

  if (!ordBaseUrlPattern.test(options.baseUrl)) {
    errors.push(`Detected invalid baseUrl: ${options.baseUrl}`);
  }
}

async function validateGithubDirectoryContents(
  path: string,
  githubInstance: GitHubInstance,
  githubToken: string,
): Promise<void> {
  const files = (await getGithubDirectoryContents(githubInstance, path, githubToken))
    .filter((item) => item.type === "file")
    .map((item) => item.path);

  // Check if there is at least one valid document
  let hasValidOrdDocument = false;

  for (const file of files.filter((file) => file.endsWith(".json"))) {
    const response = await fetchGitHubFile<GitHubFileResponse>(githubInstance, file, githubToken);

    try {
      const fileContents = Buffer.from(response.content, "base64").toString("utf-8");
      const parsedFile = JSON.parse(fileContents);
      validateOrdDocument(parsedFile as ORDDocument);
      hasValidOrdDocument = true;
    } catch {
      log.warn(`Invalid ORD document found in ${file}`);
    }
  }

  if (!hasValidOrdDocument) throw GitHubDirectoryInvalidError.forPath(path);
}

// validateSourceTypeOptions will validate given options and perform a directory structure check.
// In source type "github" it will also check the access.
async function validateSourceTypeOptions(options: CommandLineOptions, errors: string[]): Promise<void> {
  const missingParams: string[] = [];

  const githubApiUrl = options.githubApiUrl || process.env.GITHUB_API_URL;
  const githubRepository = options.githubRepository || process.env.GITHUB_REPOSITORY;
  const githubBranch = options.githubBranch || process.env.GITHUB_BRANCH;
  const githubToken = options.githubToken || process.env.GITHUB_TOKEN;

  switch (options.sourceType) {
    case OptSourceType.Local:
      if (!options.directory) {
        errors.push('--directory (-d) is required when --source-type is "local"');
      } else {
        // Check the provided local directory structure
        try {
          validateLocalDirectory(options.directory, options.documentsSubdirectory);
        } catch (error: unknown) {
          errors.push(error instanceof LocalDirectoryError ? error.message : String(error));
        }
      }
      break;
    case OptSourceType.Github:
      if (!githubApiUrl) missingParams.push("--github-api-url");
      if (!githubRepository) missingParams.push("--github-repository");
      if (!githubBranch) missingParams.push("--github-branch");
      if (!githubToken) missingParams.push("--github-token");

      if (missingParams.length > 0) {
        errors.push(`Detected missing parameters for github source type: ${missingParams.join(", ")}`);
      } else {
        // Perform GitHub access and directory structure check
        const pathSegments = normalizePath(options.directory || PATH_CONSTANTS.GITHUB_DEFAULT_ROOT);
        const documentsSubDirectory = options.documentsSubdirectory || "documents";
        try {
          await validateGithubDirectoryContents(
            joinFilePaths(pathSegments, documentsSubDirectory),
            {
              host: githubApiUrl!,
              repo: githubRepository!,
              branch: githubBranch!,
            },
            githubToken!,
          );
        } catch (error: unknown) {
          let message: string;
          if (error instanceof BackendError) {
            message = error.message;
          } else {
            message = `An unexpected error occurred: ${error}`;
          }

          errors.push(message);
        }
      }
      break;
    default:
      errors.push(`Invalid source type. Allowed options: ${Object.values(OptSourceType).join(", ")}`);
  }
}

function validateAuthOptions(authMethods: OptAuthMethod[], errors: string[]): void {
  const isOpen = authMethods.includes(OptAuthMethod.Open);
  const isBasicAuth = authMethods.includes(OptAuthMethod.Basic);

  if (isOpen && isBasicAuth) {
    errors.push('Authentication method "open" cannot be used together with other options.');
    return;
  }

  if (!isOpen && !isBasicAuth) {
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
}

function isValidBasicAuthUsers(value: unknown): value is BasicAuthUsers {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([key, value]) => typeof key === "string" && typeof value === "string" && isBcryptHash(value),
  );
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
      return fs.statSync(filePath).isFile();
    });

    if (!hasFiles) {
      throw LocalDirectoryError.forPath(
        directoryPath,
        `'${documentsSubDirectory}' folder is empty - at least one file is required: ${documentsPath}`,
      );
    }

    let hasValidOrdDocument = false;

    // Check if the openResourceDiscovery property is present in all files
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = joinFilePaths(documentsPath, file);
      const contents = fs.readFileSync(filePath).toString();

      const document = JSON.parse(contents) as ORDDocument;

      try {
        validateOrdDocument(document);
        hasValidOrdDocument = true;
      } catch {
        log.warn(`${filePath} is not valid`);
      }
    }

    if (!hasValidOrdDocument) {
      throw LocalDirectoryError.forPath(directoryPath, `No valid ORD document found in: ${directoryPath}`);
    }
  } catch (error) {
    if (error instanceof LocalDirectoryError) {
      throw error;
    }
    throw LocalDirectoryError.forPath(directoryPath, `Unexpected error: ${String(error)}`);
  }
}
