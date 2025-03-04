import { type ORDDocument } from "@sap/open-resource-discovery";

// These types map fully qualified names (FQN) to their real path in the filesystem.
// The goal is to make the files accessible via the ORD ID in the URL while maintaning compatibility
// to filesystems that do not support colons (:) in paths and have a consistent routing by ORD ID when possible.
export type FqnResourceMap = { fileName: string; filePath: string };
export type FqnDocumentMap = { [ordId: string]: FqnResourceMap[] };

function getRelativePathForResource(ordId: string, path: string): FqnResourceMap {
  const pathParts = path.split("/");
  const rootIndex = pathParts.findIndex((part) => part === ordId);
  return {
    fileName: pathParts.slice(rootIndex + 1).join("/"),
    filePath: pathParts.slice(rootIndex).join("/").replace(/:/gi, "_"),
  };
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
