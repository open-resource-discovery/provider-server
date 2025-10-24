/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { initializeGitSource } from "../gitInitializer.js";
import { ProviderServerOptions } from "../../model/server.js";
import { FileSystemManager } from "../../services/fileSystemManager.js";
import { GitCloneContentFetcher } from "../../services/gitCloneContentFetcher.js";
import { CacheService } from "../../services/cacheService.js";
import { UpdateStateManager } from "../../services/updateStateManager.js";
import { ValidationError } from "../../model/error/ValidationError.js";
import { InternalServerError } from "../../model/error/InternalServerError.js";
import * as fsPromises from "fs/promises";
import { OptSourceType } from "../../model/cli.js";

jest.mock("../../services/gitCloneContentFetcher.js");
jest.mock("../../services/fileSystemManager.js");
jest.mock("../../services/cacheService.js");
jest.mock("../../services/updateStateManager.js");
jest.mock("fs/promises");
jest.mock("../validateGit.js");
jest.mock("../directoryHash.js");
jest.mock("../logger.js", () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("gitInitializer", () => {
  let mockFileSystemManager: jest.Mocked<FileSystemManager>;
  let mockCacheService: jest.Mocked<CacheService>;
  let mockStateManager: jest.Mocked<UpdateStateManager>;
  let mockOptions: ProviderServerOptions;

  beforeEach(() => {
    jest.clearAllMocks();

    mockFileSystemManager = {
      getCurrentVersion: jest.fn(),
      getCurrentPath: jest.fn(),
      getMetadata: jest.fn(),
      cleanupTempDirectory: jest.fn(),
      getTempDirectory: jest.fn(),
      prepareTempDirectoryWithGit: jest.fn().mockResolvedValue("/data/temp"),
      swapDirectories: jest.fn(),
      saveMetadata: jest.fn(),
    } as any;

    mockCacheService = {
      warmCache: jest.fn(),
    } as any;

    mockStateManager = {
      startCacheWarming: jest.fn(),
      completeCacheWarming: jest.fn(),
      completeUpdate: jest.fn(),
      failUpdate: jest.fn(),
    } as any;

    mockOptions = {
      sourceType: OptSourceType.Github,
      githubApiUrl: "https://api.github.com",
      githubRepository: "owner/repo",
      githubBranch: "main",
      githubToken: "test-token",
      ordDirectory: "docs",
      ordDocumentsSubDirectory: "documents",
    } satisfies Partial<ProviderServerOptions> as ProviderServerOptions;
  });

  describe("initializeGitSource", () => {
    it("should successfully initialize git source on fresh clone", async () => {
      const mockMetadata = {
        commitHash: "abc123",
        directoryTreeSha: "def456",
        fetchTime: new Date(),
        branch: "main",
        repository: "owner/repo",
        totalFiles: 10,
      };

      mockFileSystemManager.getCurrentVersion.mockResolvedValue(null);
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(null);
      mockFileSystemManager.getTempDirectory.mockResolvedValue("/data/temp");

      const mockFetcher = {
        fetchAllContent: jest.fn().mockResolvedValue(mockMetadata),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent.mockImplementation(() => {});

      await initializeGitSource(mockOptions, mockFileSystemManager);

      expect(true).toBe(true);
      expect(mockFetcher.fetchAllContent).toHaveBeenCalled();
      expect(mockFileSystemManager.swapDirectories).toHaveBeenCalledWith("/data/temp");
      expect(mockFileSystemManager.saveMetadata).toHaveBeenCalledWith(mockMetadata);
    });

    it("should skip update when content is up-to-date", async () => {
      const existingMetadata = {
        commitHash: "abc123",
        branch: "main",
        repository: "owner/repo",
      };

      mockFileSystemManager.getCurrentVersion.mockResolvedValue("abc123");
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(existingMetadata as any);

      const mockFetcher = {
        getLatestCommitSha: jest.fn().mockResolvedValue("abc123"),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent.mockImplementation(() => {});

      const result = await initializeGitSource(mockOptions, mockFileSystemManager, mockStateManager);

      expect(result.contentAvailable).toBe(true);
      expect(mockFetcher.getLatestCommitSha).toHaveBeenCalled();
      expect(mockStateManager.completeUpdate).toHaveBeenCalled();
    });

    it("should fetch new content when commit hash changes", async () => {
      const existingMetadata = {
        commitHash: "abc123",
        branch: "main",
        repository: "owner/repo",
      };

      const newMetadata = {
        commitHash: "def456",
        directoryTreeSha: "ghi789",
        fetchTime: new Date(),
        branch: "main",
        repository: "owner/repo",
        totalFiles: 15,
      };

      mockFileSystemManager.getCurrentVersion.mockResolvedValue("abc123");
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(existingMetadata as any);
      mockFileSystemManager.prepareTempDirectoryWithGit.mockResolvedValue("/data/temp");

      const mockFetcher = {
        getLatestCommitSha: jest.fn().mockResolvedValue("def456"),
        fetchAllContent: jest.fn().mockResolvedValue(newMetadata),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent.mockImplementation(() => {});

      await initializeGitSource(mockOptions, mockFileSystemManager);

      expect(mockFetcher.fetchAllContent).toHaveBeenCalled();
      expect(mockFileSystemManager.swapDirectories).toHaveBeenCalled();
      expect(mockFileSystemManager.saveMetadata).toHaveBeenCalledWith(newMetadata);
    });

    it("should handle branch change by cleaning and fetching fresh content", async () => {
      const existingMetadata = {
        commitHash: "abc123",
        branch: "old-branch",
        repository: "owner/repo",
      };

      mockFileSystemManager.getCurrentVersion.mockResolvedValue("abc123");
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(existingMetadata as any);
      mockFileSystemManager.getTempDirectory.mockResolvedValue("/data/temp");

      const mockFetcher = {
        fetchAllContent: jest.fn().mockResolvedValue({
          commitHash: "newcommit",
          branch: "main",
          repository: "owner/repo",
        }),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent.mockImplementation(() => {});

      (fsPromises.rm as jest.Mock).mockResolvedValue(undefined);
      (fsPromises.mkdir as jest.Mock).mockResolvedValue(undefined);

      await initializeGitSource(mockOptions, mockFileSystemManager);

      expect(mockFileSystemManager.cleanupTempDirectory).toHaveBeenCalled();
      expect(fsPromises.rm).toHaveBeenCalledWith("/data/current", { recursive: true, force: true });
      expect(fsPromises.mkdir).toHaveBeenCalledWith("/data/current", { recursive: true });
    });

    it("should handle repository change", async () => {
      const existingMetadata = {
        commitHash: "abc123",
        branch: "main",
        repository: "owner/old-repo",
      };

      mockFileSystemManager.getCurrentVersion.mockResolvedValue("abc123");
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(existingMetadata as any);
      mockFileSystemManager.getTempDirectory.mockResolvedValue("/data/temp");

      const mockFetcher = {
        fetchAllContent: jest.fn().mockResolvedValue({
          commitHash: "newcommit",
          branch: "main",
          repository: "owner/repo",
        }),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent.mockImplementation(() => {});

      (fsPromises.rm as jest.Mock).mockResolvedValue(undefined);
      (fsPromises.mkdir as jest.Mock).mockResolvedValue(undefined);

      await initializeGitSource(mockOptions, mockFileSystemManager);

      expect(mockFileSystemManager.cleanupTempDirectory).toHaveBeenCalled();
      expect(fsPromises.rm).toHaveBeenCalled();
    });

    it("should warm cache after successful initialization", async () => {
      const mockMetadata = {
        commitHash: "abc123",
        branch: "main",
        repository: "owner/repo",
      };

      mockFileSystemManager.getCurrentVersion.mockResolvedValue(null);
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(null);
      mockFileSystemManager.getTempDirectory.mockResolvedValue("/data/temp");

      const mockFetcher = {
        fetchAllContent: jest.fn().mockResolvedValue(mockMetadata),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent.mockImplementation(() => {});

      const { calculateDirectoryHash } = require("../directoryHash.js");
      calculateDirectoryHash.mockResolvedValue("hash123");

      mockCacheService.warmCache.mockResolvedValue(undefined);

      await initializeGitSource(mockOptions, mockFileSystemManager, mockStateManager, mockCacheService);

      expect(mockStateManager.startCacheWarming).toHaveBeenCalled();
      expect(mockCacheService.warmCache).toHaveBeenCalled();
      expect(mockStateManager.completeCacheWarming).toHaveBeenCalled();
    });

    it("should handle cache warming failure gracefully", async () => {
      const mockMetadata = {
        commitHash: "abc123",
        branch: "main",
        repository: "owner/repo",
      };

      mockFileSystemManager.getCurrentVersion.mockResolvedValue(null);
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(null);
      mockFileSystemManager.getTempDirectory.mockResolvedValue("/data/temp");

      const mockFetcher = {
        fetchAllContent: jest.fn().mockResolvedValue(mockMetadata),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent.mockImplementation(() => {});

      const { calculateDirectoryHash } = require("../directoryHash.js");
      calculateDirectoryHash.mockResolvedValue("hash123");

      mockCacheService.warmCache.mockRejectedValue(new Error("Cache warming failed"));

      await initializeGitSource(mockOptions, mockFileSystemManager, mockStateManager, mockCacheService);

      expect(mockStateManager.completeCacheWarming).toHaveBeenCalled();
    });

    it("should handle validation failure by cleaning up temp directory", async () => {
      mockFileSystemManager.getCurrentVersion.mockResolvedValue(null);
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(null);
      mockFileSystemManager.getTempDirectory.mockResolvedValue("/data/temp");

      const mockFetcher = {
        fetchAllContent: jest.fn().mockResolvedValue({ commitHash: "abc123" }),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent.mockImplementation(() => {
        throw new Error("Validation failed");
      });

      await expect(initializeGitSource(mockOptions, mockFileSystemManager, mockStateManager)).rejects.toThrow();

      expect(mockFileSystemManager.cleanupTempDirectory).toHaveBeenCalled();
      expect(mockStateManager.failUpdate).toHaveBeenCalled();
    });

    it("should throw ValidationError for unexpected errors", async () => {
      mockFileSystemManager.getCurrentVersion.mockRejectedValue(new Error("Unexpected error"));

      await expect(initializeGitSource(mockOptions, mockFileSystemManager)).rejects.toThrow(ValidationError);
    });

    it("should re-throw BackendError without wrapping", async () => {
      const backendError = new InternalServerError("Backend error");
      mockFileSystemManager.getCurrentVersion.mockRejectedValue(backendError);

      await expect(initializeGitSource(mockOptions, mockFileSystemManager)).rejects.toThrow(InternalServerError);
    });

    it("should validate existing content when commit matches", async () => {
      const existingMetadata = {
        commitHash: "abc123",
        branch: "main",
        repository: "owner/repo",
      };

      mockFileSystemManager.getCurrentVersion.mockResolvedValue("abc123");
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(existingMetadata as any);

      const mockFetcher = {
        getLatestCommitSha: jest.fn().mockResolvedValue("abc123"),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent.mockImplementation(() => {});

      await initializeGitSource(mockOptions, mockFileSystemManager);

      expect(validateGitContent).toHaveBeenCalledWith("/data/current", "documents");
    });

    it("should fetch fresh content when validation of existing content fails", async () => {
      const existingMetadata = {
        commitHash: "abc123",
        branch: "main",
        repository: "owner/repo",
      };

      mockFileSystemManager.getCurrentVersion.mockResolvedValue("abc123");
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(existingMetadata as any);
      mockFileSystemManager.prepareTempDirectoryWithGit.mockResolvedValue("/data/temp");

      const mockFetcher = {
        getLatestCommitSha: jest.fn().mockResolvedValue("abc123"),
        fetchAllContent: jest.fn().mockResolvedValue(existingMetadata),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent
        .mockImplementationOnce(() => {
          throw new Error("Validation failed");
        })
        .mockImplementationOnce(() => {});

      await initializeGitSource(mockOptions, mockFileSystemManager);

      expect(mockFetcher.fetchAllContent).toHaveBeenCalled();
    });

    it("should handle null directory hash during cache warming", async () => {
      const mockMetadata = {
        commitHash: "abc123",
        branch: "main",
        repository: "owner/repo",
      };

      mockFileSystemManager.getCurrentVersion.mockResolvedValue(null);
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(null);
      mockFileSystemManager.getTempDirectory.mockResolvedValue("/data/temp");

      const mockFetcher = {
        fetchAllContent: jest.fn().mockResolvedValue(mockMetadata),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent.mockImplementation(() => {});

      const { calculateDirectoryHash } = require("../directoryHash.js");
      calculateDirectoryHash.mockResolvedValue(null);

      await initializeGitSource(mockOptions, mockFileSystemManager, mockStateManager, mockCacheService);

      expect(mockCacheService.warmCache).not.toHaveBeenCalled();
    });

    it("should warm cache for existing up-to-date content", async () => {
      const existingMetadata = {
        commitHash: "abc123",
        branch: "main",
        repository: "owner/repo",
      };

      mockFileSystemManager.getCurrentVersion.mockResolvedValue("abc123");
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(existingMetadata as any);

      const mockFetcher = {
        getLatestCommitSha: jest.fn().mockResolvedValue("abc123"),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent.mockImplementation(() => {});

      const { calculateDirectoryHash } = require("../directoryHash.js");
      calculateDirectoryHash.mockResolvedValue("hash123");

      mockCacheService.warmCache.mockResolvedValue(undefined);

      await initializeGitSource(mockOptions, mockFileSystemManager, mockStateManager, mockCacheService);

      expect(mockCacheService.warmCache).toHaveBeenCalled();
      expect(mockStateManager.startCacheWarming).toHaveBeenCalled();
      expect(mockStateManager.completeCacheWarming).toHaveBeenCalled();
    });

    it("should handle no existing metadata", async () => {
      mockFileSystemManager.getCurrentVersion.mockResolvedValue(null);
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(null);
      mockFileSystemManager.getTempDirectory.mockResolvedValue("/data/temp");

      const mockFetcher = {
        fetchAllContent: jest.fn().mockResolvedValue({
          commitHash: "abc123",
          branch: "main",
          repository: "owner/repo",
        }),
        destroy: jest.fn(),
      };

      (GitCloneContentFetcher as jest.Mock).mockImplementation(() => mockFetcher);

      const { validateGitContent } = require("../validateGit.js");
      validateGitContent.mockImplementation(() => {});

      await initializeGitSource(mockOptions, mockFileSystemManager);

      expect(mockFetcher.fetchAllContent).toHaveBeenCalled();
    });

    it("should convert non-Error exceptions to string in ValidationError", async () => {
      mockFileSystemManager.getCurrentVersion.mockRejectedValue("String error");

      await expect(initializeGitSource(mockOptions, mockFileSystemManager)).rejects.toThrow(ValidationError);
    });
  });
});
