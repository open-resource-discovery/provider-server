import { ORDConfiguration } from "@sap/open-resource-discovery";
import { AccessStrategy } from "@sap/open-resource-discovery/dist/types/v1/Configuration.js";
import path from "path";
import {
  ORD_DOCUMENTS_SUB_DIRECTORY,
  ORD_GITHUB_DEFAULT_ROOT_DIRECTORY,
  ORD_SERVER_PREFIX_PATH,
} from "src/constant.js";
import { mapOptAuthToOrdAccessStrategy, OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { GithubOpts } from "src/model/github.js";
import { listGitHubDirectory } from "src/util/github.js";

interface BaseConfig {
  sourceType: OptSourceType;
  authMethods: OptAuthMethod[];
  baseUrl?: string;
}

interface GitHubConfig extends BaseConfig {
  sourceType: OptSourceType.Github;
  githubOpts: GithubOpts;
}

interface LocalConfig extends BaseConfig {
  sourceType: OptSourceType.Local;
  ordConfig: ORDConfiguration;
  githubOpts?: GithubOpts;
}

type CreateOrdConfigGetterParams = GitHubConfig | LocalConfig;

export function createOrdConfigGetter(params: CreateOrdConfigGetterParams): () => Promise<ORDConfiguration> {
  return async (): Promise<ORDConfiguration> => {
    if (params.sourceType === OptSourceType.Github) {
      return await getGithubOrdConfig(params.authMethods, params.githubOpts, params.baseUrl);
    } else {
      return params.ordConfig;
    }
  };
}

export function listGithubOrdDirectory(githubOpts: GithubOpts): Promise<string[]> {
  const pathSegments = path.normalize(githubOpts.customDirectory || ORD_GITHUB_DEFAULT_ROOT_DIRECTORY);

  const githubInstance = {
    host: githubOpts.githubApiUrl,
    repo: githubOpts.githubRepository,
    branch: githubOpts.githubBranch,
  };

  return listGitHubDirectory(githubInstance, `${pathSegments}/documents`, githubOpts.githubToken);
}

export async function getGithubOrdConfig(
  authOpts: OptAuthMethod[],
  githubOpts: GithubOpts,
  baseUrl?: string,
): Promise<ORDConfiguration> {
  const ordConfig: ORDConfiguration = emptyOrdConfig(baseUrl);
  const accessStrategies = getOrdDocumentAccessStrategies(authOpts);
  const documents = await listGithubOrdDirectory(githubOpts);

  // Add each JSON document to the configuration
  for (const file of documents) {
    if (file.endsWith(".json")) {
      const documentName = path.basename(file, ".json");
      ordConfig.openResourceDiscoveryV1.documents?.push({
        url: `${ORD_SERVER_PREFIX_PATH}/${ORD_DOCUMENTS_SUB_DIRECTORY}/${documentName}`,
        accessStrategies,
      });
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
