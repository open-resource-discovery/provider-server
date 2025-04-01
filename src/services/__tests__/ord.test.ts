import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { APIResource, ORDConfiguration, ORDDocument, AccessStrategy } from "@open-resource-discovery/specification";
import { OptAuthMethod } from "src/model/cli.js";
import { ProcessingContext } from "src/services/interfaces/processingContext.js";
import { PATH_CONSTANTS } from "../../constant.js";
import { DocumentService } from "../documentService.js";
import { CacheService } from "../cacheService.js";
import { DocumentRepository } from "../../repositories/interfaces/documentRepository.js";
import { NotFoundError } from "../../model/error/NotFoundError.js";
import { FqnDocumentMap } from "../../util/fqnHelpers.js";

const mockRepository: jest.Mocked<DocumentRepository> = {
  getDocument: jest.fn(),
  getDocuments: jest.fn(),
  getDirectoryHash: jest.fn(),
  listFiles: jest.fn(),
  getFileContent: jest.fn(),
};

let cacheService: CacheService;

let documentService: DocumentService;
const testDocumentsDirectory = "documents";

const mockContext: ProcessingContext = {
  baseUrl: "http://127.0.0.1:8080",
  authMethods: [OptAuthMethod.Open],
};

const mockApiResource: APIResource = {
  ordId: "test:api:resource:v1",
  title: "Test API Resource",
  shortDescription: "A test API resource",
  description: "Detailed description of the test API resource",
  version: "1.0.0",
  releaseStatus: "active",
  partOfPackage: "sap:package:test:v1",
  visibility: "public",
  apiProtocol: "odata-v4",
  resourceDefinitions: [
    {
      type: "openapi-v3",
      mediaType: "application/json",
      url: "test-openapi.json",
    },
  ],
};

const mockDocument: ORDDocument = {
  openResourceDiscovery: "1.6",
  describedSystemInstance: {
    baseUrl: "http://example.com/system",
  },
  packages: [
    {
      ordId: "sap:package:test:v1",
      title: "Test Package",
      shortDescription: "Package for testing",
      description: "A package containing test resources.",
      version: "1.0.0",
      vendor: "sap:vendor:SAP:",
    },
  ],
  apiResources: [
    {
      ...mockApiResource,
    },
  ],
};

describe("DocumentService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(mockRepository).forEach((mockFn) => mockFn.mockReset());
    cacheService = new CacheService();
    documentService = new DocumentService(mockRepository, cacheService, mockContext, testDocumentsDirectory);
  });

  describe("getProcessedDocument", () => {
    const testPath = "documents/doc1.json";
    const testHash = "hash1";

    it("should fetch, process, and cache document on cache miss", async () => {
      mockRepository.getDirectoryHash.mockResolvedValue(testHash);
      mockRepository.getDocument.mockResolvedValue(mockDocument);

      const result = await documentService.getProcessedDocument(testPath);

      expect(mockRepository.getDirectoryHash).toHaveBeenCalledWith(testDocumentsDirectory);
      expect(mockRepository.getDocument).toHaveBeenCalledWith(testPath);
      expect(cacheService.getDocumentFromCache(testPath, testHash)).not.toBeNull();
      expect(result).toBeDefined();
      expect(result.apiResources?.[0].resourceDefinitions?.[0].url).toBe(
        `${PATH_CONSTANTS.SERVER_PREFIX}/test-openapi.json`,
      );

      expect(result.apiResources?.[0].resourceDefinitions?.[0].accessStrategies).toBeDefined();
      expect(result.apiResources?.[0].resourceDefinitions?.[0].accessStrategies).toHaveLength(
        mockContext.authMethods.length,
      );
    });

    it("should return cached document on cache hit", async () => {
      const processedDocForCache: ORDDocument = {
        ...mockDocument,
        apiResources: mockDocument.apiResources?.map((api) => ({
          ...api,
          resourceDefinitions: api.resourceDefinitions?.map((rd) => ({
            ...rd,
            url: `${PATH_CONSTANTS.SERVER_PREFIX}/test-openapi.json`,
            accessStrategies: [{ type: "open" }] as [AccessStrategy, ...AccessStrategy[]],
          })),
        })),
      };
      cacheService.cacheDocument(testPath, testHash, processedDocForCache);
      mockRepository.getDirectoryHash.mockResolvedValue(testHash);

      const result = await documentService.getProcessedDocument(testPath);

      expect(mockRepository.getDirectoryHash).toHaveBeenCalledWith(testDocumentsDirectory);
      expect(mockRepository.getDocument).not.toHaveBeenCalled();
      expect(result).toEqual(processedDocForCache);
    });

    it("should throw NotFoundError if document not found in repository", async () => {
      const testPath = "documents/not-found.json";
      const testHash = "hash-nf";
      mockRepository.getDirectoryHash.mockResolvedValue(testHash);
      mockRepository.getDocument.mockResolvedValue(null);

      await expect(documentService.getProcessedDocument(testPath)).rejects.toThrow(NotFoundError);
      expect(mockRepository.getDirectoryHash).toHaveBeenCalledWith(testDocumentsDirectory);
      expect(mockRepository.getDocument).toHaveBeenCalledWith(testPath);
      expect(cacheService.getDocumentFromCache(testPath, testHash)).toBeNull();
    });

    it("should throw error if directory hash cannot be obtained", async () => {
      const testPath = "documents/any.json";
      mockRepository.getDirectoryHash.mockResolvedValue(null);

      await expect(documentService.getProcessedDocument(testPath)).rejects.toThrow(
        `Could not get directory hash for ${testDocumentsDirectory}`,
      );
      expect(mockRepository.getDirectoryHash).toHaveBeenCalledWith(testDocumentsDirectory);
      expect(mockRepository.getDocument).not.toHaveBeenCalled();
    });
  });

  describe("getOrdConfiguration", () => {
    const testHash = "hash-config";

    it("should fetch docs, build config, cache all on config cache miss", async () => {
      const doc1Path = "documents/doc1.json";
      const doc2Path = "documents/doc2.json";

      const mockDocument2: ORDDocument = JSON.parse(JSON.stringify(mockDocument));

      if (mockDocument2.apiResources && mockDocument2.apiResources.length > 0) {
        mockDocument2.apiResources[0].ordId = "test:api:resource:v2";
      }

      const documentsMap = new Map<string, ORDDocument>([
        [doc1Path, mockDocument],
        [doc2Path, mockDocument2],
      ]);

      mockRepository.getDirectoryHash.mockResolvedValue(testHash);
      mockRepository.getDocuments.mockResolvedValue(documentsMap);

      const configResult = await documentService.getOrdConfiguration();

      expect(mockRepository.getDirectoryHash).toHaveBeenCalledWith(testDocumentsDirectory);
      expect(mockRepository.getDocuments).toHaveBeenCalledWith(testDocumentsDirectory);

      expect(cacheService.getCachedOrdConfig(testHash)).not.toBeNull();
      expect(cacheService.getCachedDirectoryDocumentPaths(testHash)).toEqual([doc1Path, doc2Path]);
      expect(cacheService.getCachedFqnMap(testHash)).toBeDefined();
      expect(cacheService.getDocumentFromCache(doc1Path, testHash)).not.toBeNull();
      expect(cacheService.getDocumentFromCache(doc2Path, testHash)).not.toBeNull();

      expect(configResult.openResourceDiscoveryV1.documents).toHaveLength(2);
      expect(configResult.openResourceDiscoveryV1.documents?.[0].url).toBe(
        `${PATH_CONSTANTS.SERVER_PREFIX}/documents/doc1`,
      );
      expect(configResult.openResourceDiscoveryV1.documents?.[1].url).toBe(
        `${PATH_CONSTANTS.SERVER_PREFIX}/documents/doc2`,
      );
    });

    it("should return cached config on cache hit", async () => {
      const mockCachedConfig: ORDConfiguration = {
        openResourceDiscoveryV1: { documents: [{ url: "cached", accessStrategies: [{ type: "open" }] }] }, // Added strategy
      };

      //
      mockRepository.getDirectoryHash.mockResolvedValue(testHash);
      cacheService.setCachedOrdConfig(testHash, mockCachedConfig);

      const configResult = await documentService.getOrdConfiguration();

      expect(mockRepository.getDirectoryHash).toHaveBeenCalledWith(testDocumentsDirectory);
      expect(mockRepository.getDocuments).not.toHaveBeenCalled();
      expect(configResult).toBe(mockCachedConfig);
    });

    it("should throw error if directory hash cannot be obtained", async () => {
      mockRepository.getDirectoryHash.mockResolvedValue(null);

      await expect(documentService.getOrdConfiguration()).rejects.toThrow(
        `Could not get directory hash for ${testDocumentsDirectory}`,
      );
      expect(mockRepository.getDirectoryHash).toHaveBeenCalledWith(testDocumentsDirectory);
      expect(mockRepository.getDocuments).not.toHaveBeenCalled();
    });
  });

  describe("getFqnMap", () => {
    const testHash = "hash-fqn";

    it("should fetch docs and return generated FQN map on cache miss", async () => {
      const doc1Path = "documents/doc1.json";
      const documentsMap = new Map<string, ORDDocument>([[doc1Path, mockDocument]]);

      mockRepository.getDirectoryHash.mockResolvedValue(testHash);
      mockRepository.getDocuments.mockResolvedValue(documentsMap);

      const fqnMapResult = await documentService.getFqnMap();

      expect(mockRepository.getDirectoryHash).toHaveBeenCalledWith(testDocumentsDirectory);
      expect(mockRepository.getDocuments).toHaveBeenCalledWith(testDocumentsDirectory);
      expect(cacheService.getCachedFqnMap(testHash)).not.toBeNull();
      expect(fqnMapResult).toBeDefined();
      expect(fqnMapResult[mockApiResource.ordId]).toBeDefined();
    });

    it("should return cached FQN map on cache hit", async () => {
      const mockCachedMap: FqnDocumentMap = { "test:id": [] };

      const mockMinimalConfig: ORDConfiguration = { openResourceDiscoveryV1: { documents: [] } };
      mockRepository.getDirectoryHash.mockResolvedValue(testHash);
      cacheService.setCachedFqnMap(testHash, mockCachedMap);
      cacheService.setCachedOrdConfig(testHash, mockMinimalConfig);

      const fqnMapResult = await documentService.getFqnMap();

      expect(mockRepository.getDirectoryHash).toHaveBeenCalledWith(testDocumentsDirectory);
      expect(mockRepository.getDocuments).not.toHaveBeenCalled();
      expect(fqnMapResult).toBe(mockCachedMap);
    });
  });

  describe("URL rewrite (within processDocument)", () => {
    it("should not modify remote URL in resource definitions", async () => {
      const testPath = "documents/remote.json";
      const testHash = "hash-remote-rewrite";
      const remoteUrl = "https://example.com/someresource.json";
      const docWithRemoteUrl: ORDDocument = JSON.parse(JSON.stringify(mockDocument));
      docWithRemoteUrl.apiResources![0].resourceDefinitions![0].url = remoteUrl;

      mockRepository.getDirectoryHash.mockResolvedValue(testHash);
      mockRepository.getDocument.mockResolvedValue(docWithRemoteUrl);

      const result = await documentService.getProcessedDocument(testPath);

      expect(result.apiResources?.[0].resourceDefinitions?.[0].url).toEqual(remoteUrl);
    });

    it("should modify local URL in resource definitions", async () => {
      const testPath = "documents/local-rewrite.json";
      const testHash = "hash-local-rewrite";
      const localRelativeUrl = `../${mockApiResource.ordId}/openapi-v3.json`;
      const expectedRewrittenUrl = `${PATH_CONSTANTS.SERVER_PREFIX}/${mockApiResource.ordId}/openapi-v3.json`;
      const docWithLocalUrl: ORDDocument = JSON.parse(JSON.stringify(mockDocument));

      docWithLocalUrl.apiResources![0].ordId = mockApiResource.ordId;
      docWithLocalUrl.apiResources![0].resourceDefinitions![0].url = localRelativeUrl;

      mockRepository.getDirectoryHash.mockResolvedValue(testHash);
      mockRepository.getDocument.mockResolvedValue(docWithLocalUrl);

      const result = await documentService.getProcessedDocument(testPath);

      expect(result.apiResources?.[0].resourceDefinitions?.[0].url).toEqual(expectedRewrittenUrl);
    });
  });
});
