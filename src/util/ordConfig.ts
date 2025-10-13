import { OrdConfiguration, OrdV1DocumentAccessStrategy } from "@open-resource-discovery/specification";
import { PATH_CONSTANTS } from "src/constant.js";
import { joinFilePaths, normalizePath } from "src/util/pathUtils.js";
import { mapOptAuthToOrdAccessStrategy, OptAuthMethod } from "src/model/cli.js";
import { GithubOpts } from "src/model/github.js";
import { getGithubDirectoryContents } from "src/util/github.js";

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

export function getOrdDocumentAccessStrategies(
  authOpts: OptAuthMethod[],
): [OrdV1DocumentAccessStrategy, ...OrdV1DocumentAccessStrategy[]] {
  if (authOpts.length === 0) {
    throw new Error("No authentication options passed for ORD config access strategies");
  }

  return authOpts.map((ao) => {
    const accessStrategy: OrdV1DocumentAccessStrategy = {
      type: mapOptAuthToOrdAccessStrategy(ao),
    };
    return accessStrategy;
  }) as [OrdV1DocumentAccessStrategy, ...OrdV1DocumentAccessStrategy[]];
}

export function emptyOrdConfig(baseUrl?: string): OrdConfiguration {
  const config: OrdConfiguration = {
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
  return normalizePath(baseUrl).replace(/\/$/, "");
}
