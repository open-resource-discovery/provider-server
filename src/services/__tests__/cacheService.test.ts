import { CacheService } from "../cacheService.js";
import { ORDDocument, ORDConfiguration } from "@open-resource-discovery/specification";
import { FqnDocumentMap } from "../../util/fqnHelpers.js";
import { log } from "../../util/logger.js";

jest.mock("../../util/logger.js");

describe("CacheService", () => {
  let cacheService: CacheService;
  let mockDocument: ORDDocument;
  let mockConfig: ORDConfiguration;
  let mockFqnMap: FqnDocumentMap;

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService = new CacheService();

    mockDocument = {
      $schema: "https://github.com/open-resource-discovery/spec-v1/interfaces/Document.schema.json",
      openResourceDiscovery: "1.9",
      description: "Test document",
    } as unknown as ORDDocument;

    mockConfig = {
      $schema: "https://github.com/open-resource-discovery/spec-v1/interfaces/Configuration.schema.json",
      openResourceDiscoveryV1: {
        documents: [
          {
            url: "/documents/test.json",
          },
        ],
      },
    } as unknown as ORDConfiguration;

    mockFqnMap = {
      "sap.test:apiResource:TestAPI:v1": [
        {
          fileName: "api.yaml",
          filePath: "apis/api.yaml",
        },
      ],
    };
  });

  describe("Document caching", () => {
    it("should cache and retrieve document with matching hash", () => {
      const path = "/documents/test.json";
      const dirHash = "hash123";

      cacheService.cacheDocument(path, dirHash, mockDocument);
      const retrieved = cacheService.getDocumentFromCache(path, dirHash);

      expect(retrieved).toEqual(mockDocument);
      expect(log.debug).toHaveBeenCalledWith(`Cache hit for document: ${path} with hash: ${dirHash}`);
    });

    it("should return null for document with wrong hash", () => {
      const path = "/documents/test.json";
      cacheService.cacheDocument(path, "hash123", mockDocument);

      const retrieved = cacheService.getDocumentFromCache(path, "wronghash");

      expect(retrieved).toBeNull();
      expect(log.debug).toHaveBeenCalledWith(`Cache miss for document: ${path} with hash: wronghash`);
    });

    it("should return null for non-cached document", () => {
      const retrieved = cacheService.getDocumentFromCache("/documents/missing.json", "hash123");

      expect(retrieved).toBeNull();
      expect(log.debug).toHaveBeenCalledWith("Cache miss for document: /documents/missing.json with hash: hash123");
    });

    it("should handle multiple documents with same hash", () => {
      const dirHash = "hash123";
      const doc1 = { ...mockDocument, description: "Doc 1" } as unknown as ORDDocument;
      const doc2 = { ...mockDocument, description: "Doc 2" } as unknown as ORDDocument;

      cacheService.cacheDocument("/documents/doc1.json", dirHash, doc1);
      cacheService.cacheDocument("/documents/doc2.json", dirHash, doc2);

      expect(cacheService.getDocumentFromCache("/documents/doc1.json", dirHash)).toEqual(doc1);
      expect(cacheService.getDocumentFromCache("/documents/doc2.json", dirHash)).toEqual(doc2);
    });
  });

  describe("ORD Configuration caching", () => {
    it("should cache and retrieve ORD configuration", () => {
      const dirHash = "hash456";

      cacheService.setCachedOrdConfig(dirHash, mockConfig);
      const retrieved = cacheService.getCachedOrdConfig(dirHash);

      expect(retrieved).toEqual(mockConfig);
      expect(log.debug).toHaveBeenCalledWith(`Cache hit for ORD config with hash: ${dirHash}`);
    });

    it("should return null for non-cached configuration", () => {
      const retrieved = cacheService.getCachedOrdConfig("missinghash");

      expect(retrieved).toBeNull();
      expect(log.debug).toHaveBeenCalledWith("Cache miss for ORD config with hash: missinghash");
    });
  });

  describe("Directory document paths caching", () => {
    it("should cache and retrieve directory document paths", () => {
      const dirHash = "hash789";
      const paths = ["/documents/doc1.json", "/documents/doc2.json"];

      cacheService.setCachedDirectoryDocumentPaths(dirHash, paths);
      const retrieved = cacheService.getCachedDirectoryDocumentPaths(dirHash);

      expect(retrieved).toEqual(paths);
      expect(log.debug).toHaveBeenCalledWith(`Cache hit for document paths with hash: ${dirHash}`);
    });

    it("should return null for non-cached paths", () => {
      const retrieved = cacheService.getCachedDirectoryDocumentPaths("missinghash");

      expect(retrieved).toBeNull();
      expect(log.debug).toHaveBeenCalledWith("Cache miss for document paths with hash: missinghash");
    });

    it("should associate paths when caching documents", () => {
      const dirHash = "hash000";

      cacheService.cacheDocument("/documents/doc1.json", dirHash, mockDocument);
      cacheService.cacheDocument("/documents/doc2.json", dirHash, mockDocument);

      const paths = cacheService.getCachedDirectoryDocumentPaths(dirHash);
      expect(paths).toEqual(["/documents/doc1.json", "/documents/doc2.json"]);
    });

    it("should not duplicate paths when caching same document multiple times", () => {
      const dirHash = "hash111";
      const path = "/documents/doc.json";

      cacheService.cacheDocument(path, dirHash, mockDocument);
      cacheService.cacheDocument(path, dirHash, mockDocument);

      const paths = cacheService.getCachedDirectoryDocumentPaths(dirHash);
      expect(paths).toEqual([path]);
    });
  });

  describe("FQN Map caching", () => {
    it("should cache and retrieve FQN map", () => {
      const dirHash = "hashFQN";

      cacheService.setCachedFqnMap(dirHash, mockFqnMap);
      const retrieved = cacheService.getCachedFqnMap(dirHash);

      expect(retrieved).toEqual(mockFqnMap);
      expect(log.debug).toHaveBeenCalledWith(`Cache hit for FQN map with hash: ${dirHash}`);
    });

    it("should return null for non-cached FQN map", () => {
      const retrieved = cacheService.getCachedFqnMap("missinghash");

      expect(retrieved).toBeNull();
      expect(log.debug).toHaveBeenCalledWith("Cache miss for FQN map with hash: missinghash");
    });
  });

  describe("Directory hash change detection", () => {
    it("should detect hash change and invalidate old cache", () => {
      const dirPath = "/data/current";
      const oldHash = "oldHash";
      const newHash = "newHash";

      // First time seeing directory
      const firstChange = cacheService.hasDirectoryHashChanged(dirPath, oldHash);
      expect(firstChange).toBe(false);

      // Cache some data with old hash
      cacheService.cacheDocument("/doc.json", oldHash, mockDocument);
      cacheService.setCachedOrdConfig(oldHash, mockConfig);
      cacheService.setCachedFqnMap(oldHash, mockFqnMap);

      // Hash changes
      const hasChanged = cacheService.hasDirectoryHashChanged(dirPath, newHash);
      expect(hasChanged).toBe(true);
      expect(log.info).toHaveBeenCalledWith(
        `Directory hash changed for ${dirPath}. Invalidating cache for old hash: ${oldHash}`,
      );

      // Old cache should be invalidated
      expect(cacheService.getDocumentFromCache("/doc.json", oldHash)).toBeNull();
      expect(cacheService.getCachedOrdConfig(oldHash)).toBeNull();
      expect(cacheService.getCachedFqnMap(oldHash)).toBeNull();
    });

    it("should not detect change when hash is same", () => {
      const dirPath = "/data/current";
      const hash = "sameHash";

      cacheService.hasDirectoryHashChanged(dirPath, hash);
      const hasChanged = cacheService.hasDirectoryHashChanged(dirPath, hash);

      expect(hasChanged).toBe(false);
    });

    it("should treat first time seeing hash as unchanged", () => {
      const dirPath = "/data/current";
      const hash = "firstHash";

      const hasChanged = cacheService.hasDirectoryHashChanged(dirPath, hash);

      expect(hasChanged).toBe(false);
    });
  });

  describe("Cache invalidation", () => {
    it("should invalidate all cache for a directory hash", () => {
      const dirHash = "hashToInvalidate";
      const paths = ["/doc1.json", "/doc2.json"];

      // Setup cache
      paths.forEach((path) => cacheService.cacheDocument(path, dirHash, mockDocument));
      cacheService.setCachedOrdConfig(dirHash, mockConfig);
      cacheService.setCachedFqnMap(dirHash, mockFqnMap);
      cacheService.setCachedDirectoryDocumentPaths(dirHash, paths);

      // Invalidate
      cacheService.invalidateCacheForDirectory(dirHash);

      // Verify everything is cleared
      expect(cacheService.getCachedOrdConfig(dirHash)).toBeNull();
      expect(cacheService.getCachedFqnMap(dirHash)).toBeNull();
      expect(cacheService.getCachedDirectoryDocumentPaths(dirHash)).toBeNull();
      paths.forEach((path) => {
        expect(cacheService.getDocumentFromCache(path, dirHash)).toBeNull();
      });
      expect(log.info).toHaveBeenCalledWith(`Invalidating cache for directory hash: ${dirHash}`);
    });

    it("should handle invalidation of non-existent hash gracefully", () => {
      cacheService.invalidateCacheForDirectory("nonexistent");
      expect(log.info).toHaveBeenCalledWith("Invalidating cache for directory hash: nonexistent");
    });

    it("should remove hash from tracking map during invalidation", () => {
      const dirPath = "/data/current";
      const hash = "trackedHash";

      // Track the hash
      cacheService.hasDirectoryHashChanged(dirPath, hash);

      // Invalidate and add new hash
      cacheService.invalidateCacheForDirectory(hash);
      const newHash = "newHash";
      const hasChanged = cacheService.hasDirectoryHashChanged(dirPath, newHash);

      // Should not detect as change since old hash was removed from tracking
      expect(hasChanged).toBe(false);
    });
  });

  describe("Clear all caches", () => {
    it("should clear all cached data", () => {
      // Setup various caches
      const hash1 = "hash1";
      const hash2 = "hash2";

      cacheService.cacheDocument("/doc1.json", hash1, mockDocument);
      cacheService.setCachedOrdConfig(hash1, mockConfig);
      cacheService.setCachedFqnMap(hash1, mockFqnMap);

      cacheService.cacheDocument("/doc2.json", hash2, mockDocument);
      cacheService.setCachedOrdConfig(hash2, mockConfig);

      // Track directory hashes
      cacheService.hasDirectoryHashChanged("/dir1", hash1);
      cacheService.hasDirectoryHashChanged("/dir2", hash2);

      // Clear all
      cacheService.clearCache();

      // Verify everything is cleared
      expect(cacheService.getDocumentFromCache("/doc1.json", hash1)).toBeNull();
      expect(cacheService.getDocumentFromCache("/doc2.json", hash2)).toBeNull();
      expect(cacheService.getCachedOrdConfig(hash1)).toBeNull();
      expect(cacheService.getCachedOrdConfig(hash2)).toBeNull();
      expect(cacheService.getCachedFqnMap(hash1)).toBeNull();

      // Directory tracking should also be cleared
      const hasChanged1 = cacheService.hasDirectoryHashChanged("/dir1", "newHash");
      const hasChanged2 = cacheService.hasDirectoryHashChanged("/dir2", "newHash");
      expect(hasChanged1).toBe(false);
      expect(hasChanged2).toBe(false);

      expect(log.info).toHaveBeenCalledWith("Clearing all caches");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty paths array", () => {
      const dirHash = "emptyHash";
      cacheService.setCachedDirectoryDocumentPaths(dirHash, []);

      const paths = cacheService.getCachedDirectoryDocumentPaths(dirHash);
      expect(paths).toEqual([]);
    });

    it("should handle undefined document description", () => {
      const doc = { ...mockDocument, description: undefined } as unknown as ORDDocument;
      const dirHash = "hashUndef";

      cacheService.cacheDocument("/doc.json", dirHash, doc);
      const retrieved = cacheService.getDocumentFromCache("/doc.json", dirHash);

      expect(retrieved).toEqual(doc);
    });

    it("should handle complex FQN maps", () => {
      const complexMap: FqnDocumentMap = {
        "sap.test:apiResource:API1:v1": [
          { fileName: "api1.yaml", filePath: "apis/api1.yaml" },
          { fileName: "api1.json", filePath: "apis/api1.json" },
        ],
        "sap.test:apiResource:API2:v2": [{ fileName: "api2.yaml", filePath: "apis/api2.yaml" }],
      };

      const dirHash = "complexHash";
      cacheService.setCachedFqnMap(dirHash, complexMap);
      const retrieved = cacheService.getCachedFqnMap(dirHash);

      expect(retrieved).toEqual(complexMap);
    });
  });
});
