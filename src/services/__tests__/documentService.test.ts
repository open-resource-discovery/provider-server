import { type Mock, type Mocked, vi } from "vitest";
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { OrdConfiguration, OrdDocument } from "@open-resource-discovery/specification";
import { OptAuthMethod } from "../../model/cli.js";
import { getDocumentPerspective } from "../../model/perspective.js";
import type { DocumentRepository } from "../../repositories/interfaces/documentRepository.js";
import { processOrdDocument } from "../../util/documentProcessing.js";
import { getFlattenedOrdFqnDocumentMap } from "../../util/fqnHelpers.js";
import { log } from "../../util/logger.js";
import { emptyOrdConfig, getOrdDocumentAccessStrategies } from "../../util/ordConfig.js";
import { joinUrlPaths } from "../../util/pathUtils.js";
import type { CacheService } from "../cacheService.js";
import { DocumentService } from "../documentService.js";
import type { ProcessingContext } from "../interfaces/processingContext.js";

vi.mock("../../util/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() },
}));
vi.mock("../cacheService.js");
vi.mock("../../util/ordConfig.js");
vi.mock("../../util/fqnHelpers.js");
vi.mock("../../model/perspective.js");
vi.mock("../../util/pathUtils.js");
vi.mock("../../util/documentProcessing.js");

describe("DocumentService", () => {
  let documentService: DocumentService;
  let mockRepository: Mocked<DocumentRepository>;
  let mockCacheService: Mocked<CacheService>;
  let mockProcessingContext: ProcessingContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProcessingContext = {
      baseUrl: "https://example.com",
      authMethods: [OptAuthMethod.Open],
      cfMtlsAccessStrategies: [],
    };

    mockRepository = {
      getDocument: vi.fn(),
      getDocuments: vi.fn().mockResolvedValue(new Map()),
      getDirectoryHash: vi.fn(),
      listFiles: vi.fn(),
      getFileContent: vi.fn(),
      getOrdDirectory: vi.fn().mockReturnValue("/test/dir"),
    } as any;

    mockCacheService = {
      getCachedOrdConfig: vi.fn(),
      getCachedFqnMap: vi.fn(),
      getDocumentFromCache: vi.fn(),
      cacheDocument: vi.fn(),
      setCachedOrdConfig: vi.fn(),
      setCachedFqnMap: vi.fn(),
      setCachedDirectoryDocumentPaths: vi.fn(),
      isWarming: vi.fn().mockReturnValue(false),
      getCurrentHash: vi.fn().mockReturnValue(null),
      waitForCompletion: vi.fn().mockResolvedValue(undefined),
    } as any;

    vi.mocked(emptyOrdConfig).mockReturnValue({ openResourceDiscoveryV1: { documents: [] } });
    vi.mocked(getOrdDocumentAccessStrategies).mockReturnValue([{ type: "open" }]);
    vi.mocked(getFlattenedOrdFqnDocumentMap).mockReturnValue({});
    vi.mocked(getDocumentPerspective).mockReturnValue("system-version");
    vi.mocked(joinUrlPaths).mockImplementation((...args: string[]) => args.join("/"));
    vi.mocked(processOrdDocument).mockImplementation((doc) => doc);

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

      // Make processOrdDocument throw for second document
      (processOrdDocument as Mock).mockReturnValueOnce(validDoc).mockImplementationOnce(() => {
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
