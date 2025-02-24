import { type ORDDocument } from "@sap/open-resource-discovery";
import { type FqnDocumentMap, getFlattenedOrdFqnDocumentMap } from "../fqnHelpers.js";

describe("FQN Helpers", () => {
  describe("getFlattenedOrdFqnDocumentMap", () => {
    it("should merge multiple FqnDocumentMaps from multiple ORDDocuments", () => {
      const doc1: ORDDocument = {
        apiResources: [
          {
            ordId: "urn:apiResource:example:v1",
            // @ts-expect-error Definition not complete
            resourceDefinitions: [{ url: "folder/urn:apiResource:example:v1/fileA.txt" }],
          },
        ],
      };

      const doc2: ORDDocument = {
        eventResources: [
          {
            ordId: "urn:apiResource:example:v1",
            // @ts-expect-error Definition not complete
            resourceDefinitions: [{ url: "folder/urn:apiResource:example:v1/fileB.txt" }],
          },
        ],
      };

      const result = getFlattenedOrdFqnDocumentMap([doc1, doc2]);
      const expected: FqnDocumentMap = {
        "urn:apiResource:example:v1": [
          { fileName: "fileA.txt", filePath: "urn_apiResource_example_v1/fileA.txt" },
          { fileName: "fileB.txt", filePath: "urn_apiResource_example_v1/fileB.txt" },
        ],
      };
      expect(result).toEqual(expected);
    });
  });
});
