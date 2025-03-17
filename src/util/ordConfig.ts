import { ORDConfiguration, ORDDocument } from "@open-resource-discovery/specification";
import { AccessStrategy } from "@open-resource-discovery/specification/dist/types/v1/Configuration.js";
import path from "path";
import {
  ORD_DOCUMENTS_SUB_DIRECTORY,
  ORD_GITHUB_DEFAULT_ROOT_DIRECTORY,
  ORD_SERVER_PREFIX_PATH,
} from "src/constant.js";
import { mapOptAuthToOrdAccessStrategy, OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { GitHubFileResponse, GithubOpts } from "src/model/github.js";
import { fetchGitHubFile, listGitHubDirectory } from "src/util/github.js";
import { log } from "src/util/logger.js";
import { validateOrdDocument } from "src/util/validateOrdDocument.js";

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

export function listGithubOrdDirectory(githubOpts: GithubOpts, ordSubDirectory: string): Promise<string[]> {
  const pathSegments = path.normalize(githubOpts.customDirectory || ORD_GITHUB_DEFAULT_ROOT_DIRECTORY);

  const githubInstance = {
    host: githubOpts.githubApiUrl,
    repo: githubOpts.githubRepository,
    branch: githubOpts.githubBranch,
  };

  return listGitHubDirectory(githubInstance, `${pathSegments}/${ordSubDirectory}`, githubOpts.githubToken);
}

export async function getGithubOrdConfig(
  authOpts: OptAuthMethod[],
  githubOpts: GithubOpts,
  ordSubDirectory?: string,
  baseUrl?: string,
): Promise<ORDConfiguration> {
  const ordConfig: ORDConfiguration = emptyOrdConfig(baseUrl);
  const accessStrategies = getOrdDocumentAccessStrategies(authOpts);
  const files = await listGithubOrdDirectory(githubOpts, ordSubDirectory ?? ORD_DOCUMENTS_SUB_DIRECTORY);

  // GitHub instance for fetching files
  const githubInstance = {
    host: githubOpts.githubApiUrl,
    repo: githubOpts.githubRepository,
    branch: githubOpts.githubBranch,
  };

  // Root path for GitHub files
  const rootPath: string = path.normalize(
    githubOpts.customDirectory ? githubOpts.customDirectory : ORD_GITHUB_DEFAULT_ROOT_DIRECTORY,
  );

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

        // If validation passes, add to the documents list
        const documentPath = `${ORD_SERVER_PREFIX_PATH}${file.replace(rootPath, "")}`;

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
  return `${baseUrl.replace(/\/$/, "")}`;
}
