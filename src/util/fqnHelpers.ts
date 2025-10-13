import { ordDocumentSchema, type OrdDocument } from "@open-resource-discovery/specification";
import { PATH_CONSTANTS } from "../constant.js";
import { ordIdToPathSegment } from "./pathUtils.js";

export const apiResourceOrdIdPattern = new RegExp(
  ordDocumentSchema.definitions.ApiResource.properties["ordId"]["pattern"],
);
export const eventResourceOrdIdPattern = new RegExp(
  ordDocumentSchema.definitions.EventResource.properties["ordId"]["pattern"],
);

// These types map fully qualified names (FQN) to their real path in the filesystem.
// The goal is to make the files accessible via the ORD ID in the URL while maintaning compatibility
// to filesystems that do not support colons (:) in paths and have a consistent routing by ORD ID when possible.
export type FqnResourceMap = { fileName: string; filePath: string };
export type FqnDocumentMap = { [ordId: string]: FqnResourceMap[] };

export function isOrdId(possibleOrdId: string): boolean {
  return apiResourceOrdIdPattern.test(possibleOrdId) || eventResourceOrdIdPattern.test(possibleOrdId);
}

function getRelativePathForResource(ordId: string, path: string): FqnResourceMap {
  const pathParts = path.replace(PATH_CONSTANTS.SERVER_PREFIX, "").split("/");
  const rootIndex = pathParts.findIndex((part) => part === ordId);
  const fileNameParts = pathParts.slice(rootIndex + 1);

  // Convert any ORD IDs in the path to filesystem-safe format
  const safePathParts = pathParts.map((part) => (isOrdId(part) ? ordIdToPathSegment(part) : part));

  // Filter out empty segments and join without adding leading slashes
  const fileName = fileNameParts.filter(Boolean).join("/");
  const filePath = safePathParts.filter(Boolean).join("/");

  return {
    fileName,
    filePath,
  };
}

function getOrdFqnDocumentMap(document: OrdDocument): FqnDocumentMap {
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
export function getFlattenedOrdFqnDocumentMap(documents: OrdDocument[]): FqnDocumentMap {
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
