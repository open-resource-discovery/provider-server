import { APIResource, EventResource, type ORDDocument } from "@sap/open-resource-discovery";
import path from "path";
import { ORD_GITHUB_DEFAULT_ROOT_DIRECTORY } from "src/constant.js";
import { type GitHubFileResponse, type GithubOpts } from "../model/github.js";
import { fetchGitHubFile, listGitHubDirectory } from "./github.js";

// These types map fully qualified names (FQN) to their real path in the filesystem.
// The goal is to make the files accessible via the ORD ID in the URL while maintaning compatibility
// to filesystems that do not support colons (:) in paths and have a consistent routing by ORD ID when possible.
export type FqnResourceMap = { fileName: string; filePath: string };
export type FqnDocumentMap = { [ordId: string]: FqnResourceMap[] };

function getRelativePathForResource(ordId: string, path: string): FqnResourceMap {
  const pathParts = path.split("/");
  const rootIndex = pathParts.findIndex((part) => part === ordId.replace(/:/gi, "_"));
  return {
    fileName: pathParts.slice(rootIndex + 1).join("/"),
    filePath: pathParts.slice(rootIndex).join("/"),
  };
}

export function deescapeUrlsInOrdDocument(ordDocument: ORDDocument): ORDDocument {
  const processResources = <T extends APIResource[] | EventResource[]>(resources: T): T =>
    resources?.map((resource) => {
      const { ordId } = resource;
      const escapedOrdId = ordId.replace(/:/gi, "_");

      return {
        ...resource,
        resourceDefinitions: resource.resourceDefinitions?.map((resourceDefinition) => {
          const pathParts = resourceDefinition.url.split("/");
          const ordIdIdx = pathParts.findIndex((part) => escapedOrdId === part);

          if (ordIdIdx > -1) {
            // If the path segment is an escaped ord id for filesystem compatiblity issues
            // replace it with the real ord id
            pathParts[ordIdIdx] = ordId;
          }

          return {
            ...resourceDefinition,
            url: pathParts.join("/"),
          };
        }),
      };
    }) as T;

  return {
    ...ordDocument,
    apiResources: ordDocument.apiResources ? processResources<APIResource[]>(ordDocument.apiResources) : undefined,
    eventResources: ordDocument.eventResources
      ? processResources<EventResource[]>(ordDocument.eventResources)
      : undefined,
  };
}

export async function getFlattenedOrdFqnDocumentMapFromGithub(githubOpts: GithubOpts): Promise<FqnDocumentMap> {
  const githubInstance = {
    host: githubOpts.githubApiUrl,
    repo: githubOpts.githubRepository,
    branch: githubOpts.githubBranch,
  };

  const pathSegments = path.normalize(githubOpts.customDirectory || ORD_GITHUB_DEFAULT_ROOT_DIRECTORY);
  const files = await listGitHubDirectory(githubInstance, `${pathSegments}/documents`, githubOpts.githubToken);

  const parsedOrdDocuments = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (document) => {
        const file = await fetchGitHubFile<GitHubFileResponse>(
          githubInstance,
          `${pathSegments}/documents/${document}`,
          githubOpts.githubToken,
        );

        const ordDocument = JSON.parse(Buffer.from(file.content, "base64").toString("utf-8")) as ORDDocument;
        return ordDocument;
      }),
  );

  const fqnDocumentMap = parsedOrdDocuments.length ? getFlattenedOrdFqnDocumentMap(parsedOrdDocuments) : {};
  return fqnDocumentMap;
}

function getOrdFqnDocumentMap(document: ORDDocument): FqnDocumentMap {
  const { apiResources, eventResources } = document;
  const result: FqnDocumentMap = {};
  const combinedResources = [...(apiResources || []), ...(eventResources || [])];

  if (combinedResources?.length) {
    for (const resource of combinedResources) {
      if (!resource.resourceDefinitions?.length) continue;
      result[resource.ordId] = [
        ...(result[resource.ordId] || []),
        ...resource.resourceDefinitions.map((resourceDefinition) =>
          getRelativePathForResource(resource.ordId, resourceDefinition.url),
        ),
      ];
    }
  }

  return result;
}

// Creates a merged map of resources from multiple ord documents
export function getFlattenedOrdFqnDocumentMap(documents: ORDDocument[]): FqnDocumentMap {
  return flattenOrdFqnDocumentMaps(documents.map(getOrdFqnDocumentMap));
}

// merges multiple resourcemaps of one document into one map
function flattenOrdFqnDocumentMaps(ordFqnDocumentMaps: FqnDocumentMap[]): FqnDocumentMap {
  return ordFqnDocumentMaps.reduce((acc, item) => {
    for (const [key, value] of Object.entries(item)) {
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(...value);
    }
    return acc;
  }, {});
}
