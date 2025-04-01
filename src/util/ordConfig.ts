import { ORDConfiguration, ORDDocument } from "@open-resource-discovery/specification";
import { AccessStrategy } from "@open-resource-discovery/specification/dist/types/v1/Configuration.js";
import { PATH_CONSTANTS } from "src/constant.js";
import { joinFilePaths, normalizePath } from "src/util/pathUtils.js";
import { mapOptAuthToOrdAccessStrategy, OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { GitHubFileResponse, GithubOpts } from "src/model/github.js";
import { fetchGitHubFile, getDirectoryHash, getGithubDirectoryContents } from "src/util/github.js";
import { log } from "src/util/logger.js";
import { validateOrdDocument } from "src/util/validateOrdDocument.js";
import { getOrdDocumentPath } from "./documentUrl.js";
import { OrdDocumentProcessor } from "../services/ordProcessorService.js";

interface BaseConfig {
  sourceType: OptSourceType;
  authMethods: OptAuthMethod[];
  baseUrl?: string;
}

interface GitHubConfig extends BaseConfig {
  sourceType: OptSourceType.Github;
  githubOpts: GithubOpts;
  ordSubDirectory: string;
}

interface LocalConfig extends BaseConfig {
  sourceType: OptSourceType.Local;
  ordConfig: ORDConfiguration;
}

type CreateOrdConfigGetterParams = GitHubConfig | LocalConfig;

export function createOrdConfigGetter(params: CreateOrdConfigGetterParams): () => Promise<ORDConfiguration> {
  return async (): Promise<ORDConfiguration> => {
    if (params.sourceType === OptSourceType.Github) {
      return await getGithubOrdConfig(params.authMethods, params.githubOpts, params.ordSubDirectory, params.baseUrl);
    } else {
      return params.ordConfig;
    }
  };
}

export async function listGithubOrdDirectory(githubOpts: GithubOpts, ordSubDirectory: string): Promise<string[]> {
  const pathSegments = normalizePath(githubOpts.customDirectory || PATH_CONSTANTS.GITHUB_DEFAULT_ROOT);

  const githubInstance = {
    host: githubOpts.githubApiUrl,
    repo: githubOpts.githubRepository,
    branch: githubOpts.githubBranch,
  };

  return (
    await getGithubDirectoryContents(
      githubInstance,
      joinFilePaths(pathSegments, ordSubDirectory),
      githubOpts.githubToken,
    )
  )
    .filter((item) => item.type === "file")
    .map((item) => item.path);
}

export async function getGithubOrdConfig(
  authOpts: OptAuthMethod[],
  githubOpts: GithubOpts,
  ordSubDirectory?: string,
  baseUrl?: string,
): Promise<ORDConfiguration> {
  const ordConfig: ORDConfiguration = emptyOrdConfig(baseUrl);
  const accessStrategies = getOrdDocumentAccessStrategies(authOpts);

  // Root path for GitHub files
  const rootPath: string = normalizePath(
    githubOpts.customDirectory ? githubOpts.customDirectory : PATH_CONSTANTS.GITHUB_DEFAULT_ROOT,
  );
  const subDirectory = ordSubDirectory ?? PATH_CONSTANTS.DOCUMENTS_SUBDIRECTORY;

  // Cache ordConfig
  const currentDirHash = await getDirectoryHash(
    { branch: githubOpts.githubBranch, host: githubOpts.githubApiUrl, repo: githubOpts.githubRepository },
    joinFilePaths(rootPath, subDirectory),
    githubOpts.githubToken,
  );

  if (!currentDirHash) {
    throw new Error("Could not fetch hash of subdirectory");
  }

  const cachedOrdConfig = OrdDocumentProcessor.getCachedOrdConfig(currentDirHash);
  if (cachedOrdConfig) {
    return cachedOrdConfig;
  }

  const files = await listGithubOrdDirectory(githubOpts, subDirectory);

  // GitHub instance for fetching files
  const githubInstance = {
    host: githubOpts.githubApiUrl,
    repo: githubOpts.githubRepository,
    branch: githubOpts.githubBranch,
  };

  // Add each valid JSON document to the configuration
  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        // Fetch the file content
        const response = await fetchGitHubFile<GitHubFileResponse>(
          githubInstance,
          file, // Use the full path returned by listGitHubDirectory
          githubOpts.githubToken,
        );

        // Parse the content as JSON
        const content = Buffer.from(response.content, "base64").toString("utf-8");
        const jsonData = JSON.parse(content);

        // Validate the document
        validateOrdDocument(jsonData as ORDDocument);

        // Using the same logic as in local path generation
        const documentPath = getOrdDocumentPath(rootPath, file);

        ordConfig.openResourceDiscoveryV1.documents?.push({
          url: documentPath,
          accessStrategies,
        });

        // Log successful validation
        log.info(`Valid ORD document found: ${file}`);
      } catch (error) {
        // Log validation errors but continue processing other files
        log.warn(`Invalid ORD document found in ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  OrdDocumentProcessor.setCachedOrdConfig(currentDirHash, ordConfig);

  return ordConfig;
}

export function getOrdDocumentAccessStrategies(authOpts: OptAuthMethod[]): [AccessStrategy, ...AccessStrategy[]] {
  if (authOpts.length === 0) {
    throw new Error("No authentication options passed for ORD config access strategies");
  }

  return authOpts.map((ao) => {
    const accessStrategy: AccessStrategy = {
      type: mapOptAuthToOrdAccessStrategy(ao),
    };
    return accessStrategy;
  }) as [AccessStrategy, ...AccessStrategy[]];
}

export function emptyOrdConfig(baseUrl?: string): ORDConfiguration {
  const config: ORDConfiguration = {
    openResourceDiscoveryV1: {
      documents: [],
    },
  };

  if (baseUrl) {
    config.baseUrl = baseUrl;
  }

  return config;
}

export function getBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return "";
  // Remove trailing slash for consistency
  return normalizePath(baseUrl).replace(/\/$/, "");
}
