import { RouterFactory } from "../routerFactory.js";
import { OptSourceType, OptAuthMethod } from "../../model/cli.js";
import { FileSystemManager } from "../../services/fileSystemManager.js";
import { DocumentRouter } from "../../routes/documentRouter.js";
import { CacheService } from "../../services/cacheService.js";
import { log } from "../../util/logger.js";

jest.mock("../../repositories/localDocumentRepository.js");
jest.mock("../../services/cacheService.js");
jest.mock("../../services/documentService.js");
jest.mock("../../routes/documentRouter.js");
jest.mock("../../util/logger.js", () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("RouterFactory", () => {
  let mockFileSystemManager: jest.Mocked<FileSystemManager>;

  beforeEach(() => {
    jest.clearAllMocks();

    const partialMock: Partial<FileSystemManager> = {
      getCurrentPath: jest.fn(),
      getMetadata: jest.fn(),
    };
    mockFileSystemManager = partialMock as jest.Mocked<FileSystemManager>;
  });

  describe("createRouter", () => {
    it("should create router for local source type", async () => {
      const options = {
        sourceType: OptSourceType.Local,
        baseUrl: "https://example.com",
        authMethods: [OptAuthMethod.Open],
        fqnDocumentMap: {},
        ordDirectory: "/test/data",
        documentsSubDirectory: "documents",
      };

      const result = await RouterFactory.createRouter(options);

      expect(result.router).toBeDefined();
      expect(result.cacheService).toBeDefined();
      expect(result.router).toBeInstanceOf(DocumentRouter);
      expect(result.cacheService).toBeInstanceOf(CacheService);
    });

    it("should create router for GitHub source type", async () => {
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(null);

      const options = {
        sourceType: OptSourceType.Github,
        baseUrl: "https://example.com",
        authMethods: [OptAuthMethod.Open],
        fqnDocumentMap: {},
        documentsSubDirectory: "documents",
        githubOpts: {
          githubApiUrl: "https://api.github.com",
          githubRepository: "owner/repo",
          githubBranch: "main",
          githubToken: "test-token",
        },
        fileSystemManager: mockFileSystemManager,
      };

      const result = await RouterFactory.createRouter(options);

      expect(result.router).toBeDefined();
      expect(result.cacheService).toBeDefined();
      expect(mockFileSystemManager.getCurrentPath).toHaveBeenCalled();
    });

    it("should throw error when FileSystemManager is missing for GitHub source", async () => {
      const options = {
        sourceType: OptSourceType.Github,
        baseUrl: "https://example.com",
        authMethods: [OptAuthMethod.Open],
        fqnDocumentMap: {},
        githubOpts: {
          githubApiUrl: "https://api.github.com",
          githubRepository: "owner/repo",
          githubBranch: "main",
          githubToken: "test-token",
        },
      };

      await expect(RouterFactory.createRouter(options)).rejects.toThrow(
        "FileSystemManager is required for GitHub source type",
      );
    });

    it("should throw error for invalid configuration", async () => {
      const options = {
        sourceType: OptSourceType.Local,
        baseUrl: "https://example.com",
        authMethods: [OptAuthMethod.Open],
        fqnDocumentMap: {},
        // Missing ordDirectory for local source
      };

      await expect(RouterFactory.createRouter(options)).rejects.toThrow(
        "Invalid configuration: Missing required options for the specified source type.",
      );
    });

    it("should use default documents subdirectory when not provided", async () => {
      const options = {
        sourceType: OptSourceType.Local,
        baseUrl: "https://example.com",
        authMethods: [OptAuthMethod.Open],
        fqnDocumentMap: {},
        ordDirectory: "/test/data",
      };

      const result = await RouterFactory.createRouter(options);

      expect(result.router).toBeDefined();
    });

    it("should log branch mismatch for GitHub source", async () => {
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue({
        branch: "old-branch",
        repository: "owner/repo",
        commitHash: "abc123",
        fetchTime: new Date(),
        totalFiles: 10,
      });

      const options = {
        sourceType: OptSourceType.Github,
        baseUrl: "https://example.com",
        authMethods: [OptAuthMethod.Open],
        fqnDocumentMap: {},
        documentsSubDirectory: "documents",
        githubOpts: {
          githubApiUrl: "https://api.github.com",
          githubRepository: "owner/repo",
          githubBranch: "new-branch",
          githubToken: "test-token",
        },
        fileSystemManager: mockFileSystemManager,
      };

      await RouterFactory.createRouter(options);

      expect(log.info).toHaveBeenCalledWith(expect.stringContaining("Branch/repo will be updated in background"));
    });

    it("should log repository mismatch for GitHub source", async () => {
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue({
        branch: "main",
        repository: "owner/old-repo",
        commitHash: "abc123",
        fetchTime: new Date(),
        totalFiles: 10,
      });

      const options = {
        sourceType: OptSourceType.Github,
        baseUrl: "https://example.com",
        authMethods: [OptAuthMethod.Open],
        fqnDocumentMap: {},
        documentsSubDirectory: "documents",
        githubOpts: {
          githubApiUrl: "https://api.github.com",
          githubRepository: "owner/new-repo",
          githubBranch: "main",
          githubToken: "test-token",
        },
        fileSystemManager: mockFileSystemManager,
      };

      await RouterFactory.createRouter(options);

      expect(log.info).toHaveBeenCalledWith(expect.stringContaining("Branch/repo will be updated in background"));
    });

    it("should log existing content when branch and repo match", async () => {
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue({
        branch: "main",
        repository: "owner/repo",
        commitHash: "abc123",
        fetchTime: new Date(),
        totalFiles: 10,
      });

      const options = {
        sourceType: OptSourceType.Github,
        baseUrl: "https://example.com",
        authMethods: [OptAuthMethod.Open],
        fqnDocumentMap: {},
        documentsSubDirectory: "documents",
        githubOpts: {
          githubApiUrl: "https://api.github.com",
          githubRepository: "owner/repo",
          githubBranch: "main",
          githubToken: "test-token",
        },
        fileSystemManager: mockFileSystemManager,
      };

      await RouterFactory.createRouter(options);

      expect(log.info).toHaveBeenCalledWith(expect.stringContaining("Using existing content from main branch"));
    });

    it("should handle missing metadata for GitHub source", async () => {
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(null);

      const options = {
        sourceType: OptSourceType.Github,
        baseUrl: "https://example.com",
        authMethods: [OptAuthMethod.Open],
        fqnDocumentMap: {},
        documentsSubDirectory: "documents",
        githubOpts: {
          githubApiUrl: "https://api.github.com",
          githubRepository: "owner/repo",
          githubBranch: "main",
          githubToken: "test-token",
        },
        fileSystemManager: mockFileSystemManager,
      };

      const result = await RouterFactory.createRouter(options);

      expect(result.router).toBeDefined();
    });

    it("should create processing context with all GitHub options", async () => {
      mockFileSystemManager.getCurrentPath.mockReturnValue("/data/current");
      mockFileSystemManager.getMetadata.mockResolvedValue(null);

      const options = {
        sourceType: OptSourceType.Github,
        baseUrl: "https://example.com",
        authMethods: [OptAuthMethod.Basic],
        fqnDocumentMap: {},
        documentsSubDirectory: "documents",
        githubOpts: {
          githubApiUrl: "https://api.github.com",
          githubRepository: "owner/repo",
          githubBranch: "main",
          githubToken: "test-token",
        },
        fileSystemManager: mockFileSystemManager,
      };

      const result = await RouterFactory.createRouter(options);

      expect(result.router).toBeDefined();
      expect(result.cacheService).toBeDefined();
    });
  });
});
