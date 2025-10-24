/* eslint-disable @typescript-eslint/no-explicit-any */
import { DocumentService } from "../documentService.js";
import { DocumentRepository } from "../../repositories/interfaces/documentRepository.js";
import { CacheService } from "../cacheService.js";
import { OrdDocument, OrdConfiguration } from "@open-resource-discovery/specification";
import { ProcessingContext } from "../interfaces/processingContext.js";
import { OptAuthMethod } from "../../model/cli.js";
import { log } from "../../util/logger.js";
import { emptyOrdConfig, getOrdDocumentAccessStrategies } from "../../util/ordConfig.js";
import { getFlattenedOrdFqnDocumentMap } from "../../util/fqnHelpers.js";
import { getDocumentPerspective } from "../../model/perspective.js";
import { joinUrlPaths } from "../../util/pathUtils.js";

jest.mock("../../util/logger.js");
jest.mock("../cacheService.js");
jest.mock("../../util/ordConfig.js");
jest.mock("../../util/fqnHelpers.js");
jest.mock("../../model/perspective.js");
jest.mock("../../util/pathUtils.js");

describe("DocumentService", () => {
  let documentService: DocumentService;
  let mockRepository: jest.Mocked<DocumentRepository>;
  let mockCacheService: jest.Mocked<CacheService>;
  let mockProcessingContext: ProcessingContext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProcessingContext = {
      baseUrl: "https://example.com",
      authMethods: [OptAuthMethod.Open],
    };

    mockRepository = {
      getDocument: jest.fn(),
      getDocuments: jest.fn().mockResolvedValue(new Map()),
      getDirectoryHash: jest.fn(),
      listFiles: jest.fn(),
      getFileContent: jest.fn(),
      getOrdDirectory: jest.fn().mockReturnValue("/test/dir"),
    } as any;

    mockCacheService = {
      getCachedOrdConfig: jest.fn(),
      getCachedFqnMap: jest.fn(),
      getDocumentFromCache: jest.fn(),
      cacheDocument: jest.fn(),
      setCachedOrdConfig: jest.fn(),
      setCachedFqnMap: jest.fn(),
      setCachedDirectoryDocumentPaths: jest.fn(),
      isWarming: jest.fn().mockReturnValue(false),
      getCurrentHash: jest.fn().mockReturnValue(null),
      waitForCompletion: jest.fn().mockResolvedValue(undefined),
    } as any;

    jest.mocked(emptyOrdConfig).mockReturnValue({ openResourceDiscoveryV1: { documents: [] } });
    jest.mocked(getOrdDocumentAccessStrategies).mockReturnValue([{ type: "open" }]);
    jest.mocked(getFlattenedOrdFqnDocumentMap).mockReturnValue({});
    jest.mocked(getDocumentPerspective).mockReturnValue("system-version");
    jest.mocked(joinUrlPaths).mockImplementation((...args: string[]) => args.join("/"));

    documentService = new DocumentService(mockRepository, mockCacheService, mockProcessingContext, "documents");
  });

  describe("ensureDataLoaded - cache warming scenarios", () => {
    it("should wait for cache warming when warming same hash", async () => {
      const dirHash = "hash123";

      const ordConfig: OrdConfiguration = {
        openResourceDiscoveryV1: { documents: [] },
      };
      mockCacheService.getCachedOrdConfig.mockReturnValueOnce(null).mockReturnValueOnce(ordConfig);
      mockCacheService.isWarming.mockReturnValue(true);
      mockCacheService.getCurrentHash.mockReturnValue(dirHash);

      await (documentService as any).ensureDataLoaded(dirHash);

      expect(mockCacheService.waitForCompletion).toHaveBeenCalled();
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining("Waiting for cache warming"));
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining("Cache warming completed and data is cached"));
    });

    it("should fall back to inline loading when cache warming completes without caching data", async () => {
      const dirHash = "hash123";

      mockCacheService.getCachedOrdConfig.mockReturnValue(null);
      mockCacheService.isWarming.mockReturnValue(true);
      mockCacheService.getCurrentHash.mockReturnValue(dirHash);
      mockRepository.getDocuments.mockResolvedValue(new Map());

      await (documentService as any).ensureDataLoaded(dirHash);

      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining("Cache warming completed but data not cached"));
      expect(mockRepository.getDocuments).toHaveBeenCalled();
    });

    it("should skip cache warming wait when warming different hash", async () => {
      const dirHash = "hash123";

      mockCacheService.getCachedOrdConfig.mockReturnValue(null);
      mockCacheService.isWarming.mockReturnValue(true);
      mockCacheService.getCurrentHash.mockReturnValue("different456");
      mockRepository.getDocuments.mockResolvedValue(new Map());

      await (documentService as any).ensureDataLoaded(dirHash);

      expect(mockCacheService.waitForCompletion).not.toHaveBeenCalled();
      expect(mockRepository.getDocuments).toHaveBeenCalled();
    });
  });

  describe("ensureDataLoaded - loading promise deduplication", () => {
    it("should reuse existing loading promise for same hash", async () => {
      const dirHash = "hash123";

      mockCacheService.getCachedOrdConfig.mockReturnValue(null);
      mockRepository.getDocuments.mockResolvedValue(new Map());

      // Start two concurrent loads
      const promise1 = (documentService as any).ensureDataLoaded(dirHash);
      const promise2 = (documentService as any).ensureDataLoaded(dirHash);

      await Promise.all([promise1, promise2]);

      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining("Cache load already in progress"));
      // Should only call getDocuments once
      expect(mockRepository.getDocuments).toHaveBeenCalledTimes(1);
    });
  });

  describe("loadInline - document processing errors", () => {
    it("should handle document processing errors and continue", async () => {
      const dirHash = "hash123";
      const validDoc: OrdDocument = {
        $schema: "test",
        openResourceDiscovery: "1.9",
        description: "Valid doc",
      } as any;
      const invalidDoc: OrdDocument = {
        $schema: "test",
        openResourceDiscovery: "1.9",
        description: "Invalid doc",
      } as any;

      const documentsMap = new Map([
        ["doc1.json", validDoc],
        ["doc2.json", invalidDoc],
      ]);

      mockCacheService.getCachedOrdConfig.mockReturnValue(null);
      mockRepository.getDocuments.mockResolvedValue(documentsMap);

      // Make processDocument throw for second document
      jest
        .spyOn(documentService as any, "processDocument")
        .mockReturnValueOnce(validDoc)
        .mockImplementationOnce(() => {
          throw new Error("Processing failed");
        });

      await (documentService as any).ensureDataLoaded(dirHash);

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Error processing document doc2.json"));
      // Should still cache the valid document
      expect(mockCacheService.cacheDocument).toHaveBeenCalledWith("doc1.json", dirHash, validDoc);
    });

    it("should warn when no valid documents found", async () => {
      const dirHash = "hash123";

      mockCacheService.getCachedOrdConfig.mockReturnValue(null);
      mockRepository.getDocuments.mockResolvedValue(new Map());

      await (documentService as any).ensureDataLoaded(dirHash);

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("No valid ORD documents found"));
    });

    it("should log progress every 100 documents", async () => {
      const dirHash = "hash123";
      const documentsMap = new Map();

      // Create 150 documents
      for (let i = 0; i < 150; i++) {
        const doc: OrdDocument = {
          $schema: "test",
          openResourceDiscovery: "1.9",
        };
        documentsMap.set(`doc${i}.json`, doc);
      }

      mockCacheService.getCachedOrdConfig.mockReturnValue(null);
      mockRepository.getDocuments.mockResolvedValue(documentsMap);

      await (documentService as any).ensureDataLoaded(dirHash);

      // Should log at 100 documents
      expect(log.debug).toHaveBeenCalledWith(expect.stringMatching(/Processed 100\/150/));
    });
  });

  describe("getProcessedDocument - error handling", () => {
    it("should throw error when directory hash calculation fails", async () => {
      mockRepository.getDirectoryHash.mockResolvedValue(null);

      await expect(documentService.getProcessedDocument("doc.json")).rejects.toThrow("Could not get directory hash");
    });

    it("should get document from cache when available", async () => {
      const mockDoc: OrdDocument = {
        $schema: "test",
        openResourceDiscovery: "1.9",
      } as any;

      mockRepository.getDirectoryHash.mockResolvedValue("hash123");
      mockCacheService.getDocumentFromCache.mockReturnValue(mockDoc);

      const result = await documentService.getProcessedDocument("doc.json");

      expect(result).toEqual(mockDoc);
      expect(mockRepository.getDocument).not.toHaveBeenCalled();
    });

    it("should fall back to repository when not in cache", async () => {
      const mockDoc: OrdDocument = {
        $schema: "test",
        openResourceDiscovery: "1.9",
      } as any;

      mockRepository.getDirectoryHash.mockResolvedValue("hash123");
      mockCacheService.getDocumentFromCache.mockReturnValue(null);
      mockRepository.getDocument.mockResolvedValue(mockDoc);

      const result = await documentService.getProcessedDocument("doc.json");

      expect(result).toBeTruthy();
      expect(mockRepository.getDocument).toHaveBeenCalledWith("doc.json");
    });

    it("should throw NotFoundError when document not found in repository", async () => {
      mockRepository.getDirectoryHash.mockResolvedValue("hash123");
      mockCacheService.getDocumentFromCache.mockReturnValue(null);
      mockRepository.getDocument.mockResolvedValue(null);

      await expect(documentService.getProcessedDocument("missing.json")).rejects.toThrow("Document not found");
    });
  });

  describe("getOrdConfiguration - error handling", () => {
    it("should throw error when directory hash fails", async () => {
      mockRepository.getDirectoryHash.mockResolvedValue(null);

      await expect(documentService.getOrdConfiguration()).rejects.toThrow("Could not get directory hash");
    });

    it("should return cached configuration when available", async () => {
      const mockConfig: OrdConfiguration = {
        openResourceDiscoveryV1: { documents: [] },
      };

      mockRepository.getDirectoryHash.mockResolvedValue("hash123");
      mockCacheService.getCachedOrdConfig.mockReturnValue(mockConfig);

      const result = await documentService.getOrdConfiguration();

      expect(result).toEqual(mockConfig);
    });

    it("should throw error when config cannot be loaded", async () => {
      mockRepository.getDirectoryHash.mockResolvedValue("hash123");
      mockCacheService.getCachedOrdConfig.mockReturnValue(null);
      mockRepository.getDocuments.mockResolvedValue(new Map());

      await expect(documentService.getOrdConfiguration()).rejects.toThrow("Failed to load ORD configuration");
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining("Failed to retrieve cached config"));
    });
  });

  describe("getFqnMap - error handling", () => {
    it("should throw error when directory hash fails", async () => {
      mockRepository.getDirectoryHash.mockResolvedValue(null);

      await expect(documentService.getFqnMap()).rejects.toThrow("Could not get directory hash");
    });

    it("should return cached FQN map when available", async () => {
      const mockFqnMap = { "test:api:v1": [{ fileName: "test.yaml", filePath: "apis/test.yaml" }] };

      mockRepository.getDirectoryHash.mockResolvedValue("hash123");
      mockCacheService.getCachedFqnMap.mockReturnValue(mockFqnMap);

      const result = await documentService.getFqnMap();

      expect(result).toEqual(mockFqnMap);
    });

    it("should throw error when FQN map cannot be loaded", async () => {
      mockRepository.getDirectoryHash.mockResolvedValue("hash123");
      mockCacheService.getCachedOrdConfig.mockReturnValue(null);
      mockCacheService.getCachedFqnMap.mockReturnValue(null);
      mockRepository.getDocuments.mockResolvedValue(new Map());

      await expect(documentService.getFqnMap()).rejects.toThrow("Failed to load FQN map");
    });
  });

  describe("getFileContent", () => {
    it("should return file content from repository", async () => {
      const content = "test file content";
      mockRepository.getFileContent.mockResolvedValue(content);

      const result = await documentService.getFileContent("file.txt");

      expect(result).toBe(content);
    });

    it("should throw NotFoundError when file not found", async () => {
      mockRepository.getFileContent.mockResolvedValue(null);

      await expect(documentService.getFileContent("missing.txt")).rejects.toThrow("File not found");
    });
  });
});
