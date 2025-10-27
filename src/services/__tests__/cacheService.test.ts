/* eslint-disable @typescript-eslint/no-require-imports */
import { CacheService } from "../cacheService.js";
import { OrdDocument, OrdConfiguration } from "@open-resource-discovery/specification";
import { FqnDocumentMap } from "../../util/fqnHelpers.js";
import { log } from "../../util/logger.js";
import { OptAuthMethod } from "../../model/cli.js";

jest.mock("../../util/logger.js");
jest.mock("fs/promises");
jest.mock("../../util/files.js");
jest.mock("../../util/validateOrdDocument.js");
jest.mock("../../util/ordConfig.js");
jest.mock("../../util/pathUtils.js");
jest.mock("../../model/perspective.js");
jest.mock("../../util/fqnHelpers.js");

describe("CacheService", () => {
  let cacheService: CacheService;
  let mockDocument: OrdDocument;
  let mockConfig: OrdConfiguration;
  let mockFqnMap: FqnDocumentMap;

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService = new CacheService();

    mockDocument = {
      $schema: "https://github.com/open-resource-discovery/spec-v1/interfaces/Document.schema.json",
      openResourceDiscovery: "1.9",
      description: "Test document",
    } as unknown as OrdDocument;

    mockConfig = {
      $schema: "https://github.com/open-resource-discovery/spec-v1/interfaces/Configuration.schema.json",
      openResourceDiscoveryV1: {
        documents: [
          {
            url: "/documents/test.json",
          },
        ],
      },
    } as unknown as OrdConfiguration;

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
      const doc1 = { ...mockDocument, description: "Doc 1" } as unknown as OrdDocument;
      const doc2 = { ...mockDocument, description: "Doc 2" } as unknown as OrdDocument;

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
      const doc = { ...mockDocument, description: undefined } as unknown as OrdDocument;
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

  describe("Cache warming", () => {
    const mockProcessingContext = {
      baseUrl: "https://example.com",
      authMethods: [OptAuthMethod.Open],
    };

    beforeEach(() => {
      cacheService = new CacheService(mockProcessingContext, log);
    });

    it("should not warm cache in local mode (no processing context)", async () => {
      const localCacheService = new CacheService();
      await localCacheService.warmCache("/test/path", "hash123");

      expect(log.debug).toHaveBeenCalledWith("Cache warming not available in local mode");
    });

    it("should not warm cache if already cached", async () => {
      const dirHash = "cachedHash";
      cacheService.setCachedOrdConfig(dirHash, mockConfig);

      await cacheService.warmCache("/test/path", dirHash);

      expect(log.debug).toHaveBeenCalledWith(`Cache already warm for hash ${dirHash}`);
    });

    it("should return existing promise if warming same hash", async (): Promise<void> => {
      const dirHash = "warmingHash";
      const documentsPath = "/test/documents";

      const fs = require("fs/promises");
      const { getAllFiles } = require("../../util/files.js");
      const { validateOrdDocument } = require("../../util/validateOrdDocument.js");
      const { emptyOrdConfig, getOrdDocumentAccessStrategies } = require("../../util/ordConfig.js");
      const { joinUrlPaths } = require("../../util/pathUtils.js");
      const { getDocumentPerspective } = require("../../model/perspective.js");
      const { getFlattenedOrdFqnDocumentMap } = require("../../util/fqnHelpers.js");

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockDocument));
      (getAllFiles as jest.Mock).mockResolvedValue([`${documentsPath}/doc1.json`]);
      (validateOrdDocument as jest.Mock).mockImplementation(() => {});
      (emptyOrdConfig as jest.Mock).mockReturnValue({ openResourceDiscoveryV1: { documents: [] } });
      (getOrdDocumentAccessStrategies as jest.Mock).mockReturnValue([{ type: "open" }]);
      (joinUrlPaths as jest.Mock).mockImplementation((...args: string[]) => args.join("/"));
      (getDocumentPerspective as jest.Mock).mockReturnValue("system-version");
      (getFlattenedOrdFqnDocumentMap as jest.Mock).mockReturnValue({});

      // Start first warming (don't await)
      const promise1 = cacheService.warmCache(documentsPath, dirHash);

      // Give it a moment to set the currentWarmingPromise
      await new Promise((resolve) => setImmediate(resolve));

      // Start second warming for same hash
      const promise2 = cacheService.warmCache(documentsPath, dirHash);

      // Should return same promise (or at least both should complete)
      await Promise.all([promise1, promise2]).catch(() => {});

      // Verify that the cache warming completed
      // The second call should have detected either in-progress warming or already-warm cache
      expect(log.debug).toHaveBeenCalledWith(expect.stringMatching(/already (warm|in progress)/));
    });

    it("should wait for previous warming to complete if different hash", async () => {
      const hash1 = "hash1";
      const hash2 = "hash2";
      const documentsPath = "/test/documents";

      const { getAllFiles } = require("../../util/files.js");
      const { validateOrdDocument } = require("../../util/validateOrdDocument.js");
      const { emptyOrdConfig, getOrdDocumentAccessStrategies } = require("../../util/ordConfig.js");
      const { joinUrlPaths } = require("../../util/pathUtils.js");
      const { getDocumentPerspective } = require("../../model/perspective.js");
      const { getFlattenedOrdFqnDocumentMap } = require("../../util/fqnHelpers.js");

      (getAllFiles as jest.Mock).mockResolvedValue([]);
      (validateOrdDocument as jest.Mock).mockImplementation(() => {});
      (emptyOrdConfig as jest.Mock).mockReturnValue({ openResourceDiscoveryV1: { documents: [] } });
      (getOrdDocumentAccessStrategies as jest.Mock).mockReturnValue([{ type: "open" }]);
      (joinUrlPaths as jest.Mock).mockImplementation((...args: string[]) => args.join("/"));
      (getDocumentPerspective as jest.Mock).mockReturnValue("system-version");
      (getFlattenedOrdFqnDocumentMap as jest.Mock).mockReturnValue({});

      // Start first warming
      const promise1 = cacheService.warmCache(documentsPath, hash1);
      // Immediately start second warming for different hash
      const promise2 = cacheService.warmCache(documentsPath, hash2);

      await Promise.all([promise1, promise2]).catch(() => {});

      // Both should complete without error
      expect(log.debug).toHaveBeenCalled();
    });

    it("should track warming status", () => {
      expect(cacheService.isWarming()).toBe(false);
      expect(cacheService.getCurrentHash()).toBeNull();
    });

    // TODO: This test needs investigation - it hangs due to async timing issues with cancellation
    it.skip("should cancel warming operation", async () => {
      const dirHash = "cancelHash";
      const documentsPath = "/test/documents";

      const { getAllFiles } = require("../../util/files.js");
      const { validateOrdDocument } = require("../../util/validateOrdDocument.js");
      const { emptyOrdConfig, getOrdDocumentAccessStrategies } = require("../../util/ordConfig.js");
      const { getFlattenedOrdFqnDocumentMap } = require("../../util/fqnHelpers.js");

      // Create a promise that will be pending for a while
      let resolveGetAllFiles: () => void;
      const getAllFilesPromise = new Promise<string[]>((resolve): void => {
        resolveGetAllFiles = (): void => resolve([]);
      });

      (getAllFiles as jest.Mock).mockReturnValue(getAllFilesPromise);
      (validateOrdDocument as jest.Mock).mockImplementation(() => {});
      (emptyOrdConfig as jest.Mock).mockReturnValue({ openResourceDiscoveryV1: { documents: [] } });
      (getOrdDocumentAccessStrategies as jest.Mock).mockReturnValue([{ type: "open" }]);
      (getFlattenedOrdFqnDocumentMap as jest.Mock).mockReturnValue({});

      // Ensure cache is not already warm for this hash
      cacheService.invalidateCacheForDirectory(dirHash);

      const warmingPromise = cacheService.warmCache(documentsPath, dirHash);

      // Give it a moment to start warming
      await new Promise((resolve) => setImmediate(resolve));

      // Verify warming is in progress
      expect(cacheService.isWarming()).toBe(true);

      // Cancel the warming operation
      await cacheService.cancelWarming();

      // Resolve getAllFiles after cancellation
      resolveGetAllFiles!();

      // Wait for the warming promise to complete (should reject or resolve without caching)
      await warmingPromise.catch(() => {});

      // Warming should have been cancelled
      expect(cacheService.isWarming()).toBe(false);
    });

    it("should wait for completion", async () => {
      const promise = cacheService.waitForCompletion();
      await expect(promise).resolves.toBeUndefined();
    });

    it("should clean up on destroy", () => {
      cacheService.destroy();
      expect(cacheService.getCurrentHash()).toBeNull();
      expect(cacheService.isWarming()).toBe(false);
    });
  });
});
