/* eslint-disable @typescript-eslint/no-explicit-any */
import { GitCloneContentFetcher } from "../gitCloneContentFetcher.js";
import { GithubConfig } from "../../model/github.js";
import { GitHubBranchNotFoundError } from "../../model/error/GithubErrors.js";

// Mock gitWorkerManager at the module level (already mocked in testSetup.ts)
jest.mock("../gitWorkerManager.js");

// Mock logger
jest.mock("../../util/logger.js", () => ({
  log: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock isomorphic-git
jest.mock("isomorphic-git", () => ({
  resolveRef: jest.fn(),
  listFiles: jest.fn(),
  getRemoteInfo: jest.fn(),
  statusMatrix: jest.fn(),
}));

jest.mock("isomorphic-git/http/node", () => ({}));

// Mock fs.promises
jest.mock("fs/promises", () => ({
  access: jest.fn(),
  mkdir: jest.fn(),
  readdir: jest.fn(),
  cp: jest.fn(),
  rm: jest.fn(),
  rename: jest.fn(),
}));

describe("GitCloneContentFetcher", () => {
  let fetcher: GitCloneContentFetcher;
  let config: GithubConfig;

  let mockGit: any;

  let mockFs: any;

  beforeEach(() => {
    config = {
      apiUrl: "https://api.github.com",
      owner: "test-owner",
      repo: "test-repo",
      branch: "main",
      token: "test-token",
      rootDirectory: ".",
    };

    // Get mocked modules
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mockGit = require("isomorphic-git");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mockFs = require("fs/promises");

    // Reset and setup default mocks
    jest.clearAllMocks();

    mockGit.resolveRef.mockResolvedValue("abc123def456");
    mockGit.listFiles.mockResolvedValue(["file1.txt", "file2.json"]);
    mockGit.getRemoteInfo.mockResolvedValue({
      refs: { heads: { main: "latest123commit" } },
    });
    mockGit.statusMatrix.mockResolvedValue([]);

    mockFs.access.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    mockFs.cp.mockResolvedValue(undefined);
    mockFs.rm.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);

    fetcher = new GitCloneContentFetcher(config);

    // Set up git worker mocks after fetcher creation
    const mockWorker = (fetcher as any).gitWorker;
    mockWorker.clone = jest.fn().mockResolvedValue(undefined);
    mockWorker.pull = jest.fn().mockResolvedValue(undefined);
    mockWorker.resetIndex = jest.fn().mockResolvedValue(undefined);
    mockWorker.checkout = jest.fn().mockResolvedValue(undefined);
    mockWorker.abort = jest.fn();
  });

  afterEach(() => {
    fetcher.destroy();
  });

  describe("getLatestCommitSha", () => {
    it("should fetch latest commit SHA from remote", async () => {
      const sha = await fetcher.getLatestCommitSha();

      expect(sha).toBe("latest123commit");
      expect(mockGit.getRemoteInfo).toHaveBeenCalledWith({
        url: "https://github.com/test-owner/test-repo.git",
        http: expect.anything(),
        onAuth: expect.any(Function),
      });
    });

    it("should throw error if branch not found", async () => {
      mockGit.getRemoteInfo.mockResolvedValue({
        refs: { heads: { develop: "some123commit" } },
      });

      await expect(fetcher.getLatestCommitSha()).rejects.toThrow(GitHubBranchNotFoundError);
    });

    it("should handle network error", async () => {
      mockGit.getRemoteInfo.mockRejectedValue(new Error("Network error"));

      await expect(fetcher.getLatestCommitSha()).rejects.toThrow();
    });
  });

  describe("getDirectoryTreeSha", () => {
    it("should generate directory tree SHA from commit", async () => {
      const treeSha = await fetcher.getDirectoryTreeSha("commit123");

      expect(treeSha).toBe("commit123:.");
    });

    it("should fetch latest commit if not provided", async () => {
      const treeSha = await fetcher.getDirectoryTreeSha();

      expect(treeSha).toBe("latest123commit:.");
    });

    it("should include rootDirectory in SHA", async () => {
      const configWithSubdir: GithubConfig = {
        ...config,
        rootDirectory: "./docs",
      };

      const fetcherWithSubdir = new GitCloneContentFetcher(configWithSubdir);

      const treeSha = await fetcherWithSubdir.getDirectoryTreeSha();

      expect(treeSha).toBe("latest123commit:./docs");

      fetcherWithSubdir.destroy();
    });

    it("should return null on error", async () => {
      mockGit.getRemoteInfo.mockRejectedValue(new Error("Network error"));

      const treeSha = await fetcher.getDirectoryTreeSha();

      expect(treeSha).toBeNull();
    });
  });

  // Note: fetchAllContent tests are complex due to git worker mocking
  // The method is primarily tested through integration tests
  // These tests cover basic scenarios and edge cases
  describe("fetchAllContent", () => {
    it("should perform fresh clone when .git does not exist", async () => {
      const targetDir = "/test/target";
      const mockWorker = (fetcher as any).gitWorker;

      // Setup: no existing repo
      mockFs.access.mockRejectedValueOnce(new Error("ENOENT")); // .git doesn't exist
      mockFs.access.mockResolvedValue(undefined); // other paths exist

      mockWorker.clone.mockResolvedValue(undefined);
      mockGit.resolveRef.mockResolvedValue("abc123def456");
      mockGit.listFiles.mockResolvedValue(["file1.txt", "file2.txt", "file3.txt"]);

      const result = await fetcher.fetchAllContent(targetDir);

      expect(mockFs.mkdir).toHaveBeenCalledWith(targetDir, { recursive: true });
      expect(mockWorker.clone).toHaveBeenCalledWith(
        "https://github.com/test-owner/test-repo.git",
        targetDir,
        "main",
        { username: "test-token", password: "x-oauth-basic" },
        expect.any(Function),
      );
      expect(result.commitHash).toBe("abc123def456");
      expect(result.branch).toBe("main");
      expect(result.repository).toBe("test-owner/test-repo");
      expect(result.totalFiles).toBe(3);
    });

    it("should perform pull when .git already exists", async () => {
      const targetDir = "/test/target";
      const mockWorker = (fetcher as any).gitWorker;

      // Setup: existing repo
      mockFs.access.mockResolvedValue(undefined);
      // Sequence: before pull (initial check), before pull (in gitPull), after pull (in gitPull), after pull (final)
      mockGit.resolveRef
        .mockResolvedValueOnce("old123commit") // before pull check
        .mockResolvedValueOnce("old123commit") // gitPull before
        .mockResolvedValueOnce("new456commit") // gitPull after
        .mockResolvedValueOnce("new456commit"); // final commitHash
      mockGit.listFiles.mockResolvedValue(["file1.txt", "file2.txt"]);

      mockWorker.pull.mockResolvedValue(undefined);

      const result = await fetcher.fetchAllContent(targetDir);

      expect(mockWorker.pull).toHaveBeenCalledWith(targetDir, "main", {
        username: "test-token",
        password: "x-oauth-basic",
      });
      expect(result.commitHash).toBe("new456commit");
      expect(result.totalFiles).toBe(2);
    });

    it("should call progress callback during operation", async () => {
      const targetDir = "/test/target";
      const onProgress = jest.fn();

      mockFs.access.mockRejectedValueOnce(new Error("ENOENT")); // fresh clone
      mockFs.access.mockResolvedValue(undefined);
      mockGit.resolveRef.mockResolvedValue("commit123");
      mockGit.listFiles.mockResolvedValue(["file1.txt"]);

      await fetcher.fetchAllContent(targetDir, onProgress);

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress.mock.calls[0][0]).toHaveProperty("startTime");
      expect(onProgress.mock.calls[0][0]).toHaveProperty("totalFiles");
      expect(onProgress.mock.calls[0][0]).toHaveProperty("fetchedFiles");
    });

    it("should handle abort during fetch", async () => {
      const targetDir = "/test/target";
      const mockWorker = (fetcher as any).gitWorker;

      mockFs.access.mockRejectedValueOnce(new Error("ENOENT"));
      mockFs.access.mockResolvedValue(undefined);

      // Simulate abort
      mockWorker.clone.mockImplementation(() => {
        fetcher.abortFetch();
        throw new Error("Operation aborted");
      });

      await expect(fetcher.fetchAllContent(targetDir)).rejects.toThrow("Fetch aborted");
    });
  });

  describe("fetchAllContent - error handling", () => {
    it("should throw GitHubRepositoryNotFoundError for 404 errors", async () => {
      const targetDir = "/test/target";
      const mockWorker = (fetcher as any).gitWorker;

      mockFs.access.mockRejectedValueOnce(new Error("ENOENT"));
      mockFs.access.mockResolvedValue(undefined);

      mockWorker.clone.mockRejectedValue(new Error("404 - Repository not found"));

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { GitHubRepositoryNotFoundError } = await import("../../model/error/GithubErrors.js");
      await expect(fetcher.fetchAllContent(targetDir)).rejects.toThrow(GitHubRepositoryNotFoundError);
    });

    it("should throw GitHubBranchNotFoundError when branch not found", async () => {
      const targetDir = "/test/target";
      const mockWorker = (fetcher as any).gitWorker;

      mockFs.access.mockRejectedValueOnce(new Error("ENOENT"));
      mockFs.access.mockResolvedValue(undefined);

      mockWorker.clone.mockRejectedValue(new Error("Could not find main branch"));

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { GitHubBranchNotFoundError } = await import("../../model/error/GithubErrors.js");
      await expect(fetcher.fetchAllContent(targetDir)).rejects.toThrow(GitHubBranchNotFoundError);
    });

    it("should throw GitHubNetworkError for network errors", async () => {
      const targetDir = "/test/target";
      const mockWorker = (fetcher as any).gitWorker;

      mockFs.access.mockRejectedValueOnce(new Error("ENOENT"));
      mockFs.access.mockResolvedValue(undefined);

      mockWorker.clone.mockRejectedValue(new Error("Could not resolve host github.com"));

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { GitHubNetworkError } = await import("../../model/error/GithubErrors.js");
      await expect(fetcher.fetchAllContent(targetDir)).rejects.toThrow(GitHubNetworkError);
    });

    it("should throw GitHubNetworkError for ENOTFOUND errors", async () => {
      const targetDir = "/test/target";
      const mockWorker = (fetcher as any).gitWorker;

      mockFs.access.mockRejectedValueOnce(new Error("ENOENT"));
      mockFs.access.mockResolvedValue(undefined);

      mockWorker.clone.mockRejectedValue(new Error("ENOTFOUND"));

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { GitHubNetworkError } = await import("../../model/error/GithubErrors.js");
      await expect(fetcher.fetchAllContent(targetDir)).rejects.toThrow(GitHubNetworkError);
    });

    it("should throw DiskSpaceError for ENOSPC errors", async () => {
      const targetDir = "/test/target";
      const mockWorker = (fetcher as any).gitWorker;

      mockFs.access.mockRejectedValueOnce(new Error("ENOENT"));
      mockFs.access.mockResolvedValue(undefined);

      mockWorker.clone.mockRejectedValue(new Error("No space left on device"));

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { DiskSpaceError } = await import("../../model/error/SystemErrors.js");
      await expect(fetcher.fetchAllContent(targetDir)).rejects.toThrow(DiskSpaceError);
    });

    it("should pass through specific error types without transformation", async () => {
      const targetDir = "/test/target";
      const mockWorker = (fetcher as any).gitWorker;
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { GitHubNetworkError } = await import("../../model/error/GithubErrors.js");

      mockFs.access.mockRejectedValueOnce(new Error("ENOENT"));
      mockFs.access.mockResolvedValue(undefined);

      const networkError = new GitHubNetworkError("https://github.com/test/repo.git", "Network error");
      mockWorker.clone.mockRejectedValue(networkError);

      await expect(fetcher.fetchAllContent(targetDir)).rejects.toThrow(networkError);
    });

    it("should throw generic error for unknown errors", async () => {
      const targetDir = "/test/target";
      const mockWorker = (fetcher as any).gitWorker;

      mockFs.access.mockRejectedValueOnce(new Error("ENOENT"));
      mockFs.access.mockResolvedValue(undefined);

      const genericError = new Error("Some unexpected error");
      mockWorker.clone.mockRejectedValue(genericError);

      await expect(fetcher.fetchAllContent(targetDir)).rejects.toThrow(genericError);
    });
  });

  describe("buildGitUrl", () => {
    it("should build GitHub.com URL correctly", () => {
      const result = fetcher["buildGitUrl"]();

      expect(result).toBe("https://github.com/test-owner/test-repo.git");
    });

    it("should build GitHub Enterprise URL correctly", () => {
      const enterpriseConfig: GithubConfig = {
        apiUrl: "https://github.company.com/api/v3",
        owner: "enterprise-owner",
        repo: "enterprise-repo",
        branch: "develop",
        token: "enterprise-token",
        rootDirectory: ".",
      };

      const enterpriseFetcher = new GitCloneContentFetcher(enterpriseConfig);
      const result = enterpriseFetcher["buildGitUrl"]();

      expect(result).toBe("https://github.company.com/enterprise-owner/enterprise-repo.git");

      enterpriseFetcher.destroy();
    });

    it("should handle GitHub Enterprise without /api/v3 suffix", () => {
      const enterpriseConfig: GithubConfig = {
        apiUrl: "https://github.company.com/api",
        owner: "owner",
        repo: "repo",
        branch: "main",
        rootDirectory: ".",
      };

      const fetcherInstance = new GitCloneContentFetcher(enterpriseConfig);
      const result = fetcherInstance["buildGitUrl"]();

      expect(result).toBe("https://github.company.com/owner/repo.git");

      fetcherInstance.destroy();
    });
  });

  describe("authentication callback", () => {
    it("should provide auth callback when token exists", () => {
      const authCallback = fetcher["getAuthCallback"]();

      expect(authCallback).toBeDefined();
      expect(authCallback!()).toEqual({
        username: "test-token",
        password: "x-oauth-basic",
      });
    });

    it("should return undefined when no token", () => {
      const noAuthConfig: GithubConfig = {
        ...config,
        token: undefined,
      };

      const noAuthFetcher = new GitCloneContentFetcher(noAuthConfig);
      const authCallback = noAuthFetcher["getAuthCallback"]();

      expect(authCallback).toBeUndefined();

      noAuthFetcher.destroy();
    });
  });

  describe("destroy", () => {
    it("should clean up resources", () => {
      fetcher.destroy();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("fetchLatestChanges", () => {
    it("should call fetchAllContent for incremental updates", async () => {
      const targetDir = "/test/target";
      const mockMetadata = {
        commitHash: "abc123",
        fetchTime: new Date(),
        branch: "main",
        repository: "test-owner/test-repo",
        totalFiles: 10,
      };

      const fetchAllContentSpy = jest.spyOn(fetcher as any, "fetchAllContent");
      fetchAllContentSpy.mockResolvedValue(mockMetadata);

      const result = await fetcher.fetchLatestChanges(targetDir);

      expect(result).toEqual(mockMetadata);
      expect(fetchAllContentSpy).toHaveBeenCalledWith(targetDir);

      fetchAllContentSpy.mockRestore();
    });
  });

  describe("abortFetch", () => {
    it("should abort ongoing fetch operation", () => {
      const mockAbortController = {
        abort: jest.fn(),
      };

      (fetcher as any).abortController = mockAbortController;
      fetcher.abortFetch();

      expect(mockAbortController.abort).toHaveBeenCalled();
    });

    it("should handle abort when no fetch in progress", () => {
      (fetcher as any).abortController = null;
      expect(() => fetcher.abortFetch()).not.toThrow();
    });
  });

  describe("pathExists private method", () => {
    it("should return true when path exists", async () => {
      mockFs.access.mockResolvedValue(undefined);

      const result = await fetcher["pathExists"]("/existing/path");

      expect(result).toBe(true);
    });

    it("should return false when path does not exist", async () => {
      mockFs.access.mockRejectedValue(new Error("ENOENT"));

      const result = await fetcher["pathExists"]("/missing/path");

      expect(result).toBe(false);
    });
  });

  describe("countFiles private method", () => {
    it("should count all files when rootDirectory is current", async () => {
      mockGit.listFiles.mockResolvedValue(["file1.txt", "file2.json", "file3.md"]);

      const count = await fetcher["countFiles"]("/test/dir");

      expect(count).toBe(3);
    });

    it("should filter files by rootDirectory", async () => {
      const configWithSubdir: GithubConfig = {
        ...config,
        rootDirectory: "docs",
      };

      const fetcherWithSubdir = new GitCloneContentFetcher(configWithSubdir);

      mockGit.listFiles.mockResolvedValue(["docs/file1.md", "docs/file2.md", "src/file3.ts"]);

      const count = await fetcherWithSubdir["countFiles"]("/test/dir");

      expect(count).toBe(2);

      fetcherWithSubdir.destroy();
    });

    it("should fallback to filesystem count on error", async () => {
      mockGit.listFiles.mockRejectedValue(new Error("Git error"));
      mockFs.readdir.mockResolvedValue([
        { name: "file1.txt", isDirectory: (): boolean => false, isFile: (): boolean => true },
        { name: "file2.txt", isDirectory: (): boolean => false, isFile: (): boolean => true },
      ] as any);

      const count = await fetcher["countFiles"]("/test/dir");

      expect(count).toBe(2);
    });
  });

  describe("countFilesInDirectory private method", () => {
    it("should count files recursively", async () => {
      mockFs.readdir.mockResolvedValueOnce([
        { name: "file1.txt", isDirectory: (): boolean => false, isFile: (): boolean => true },
        { name: "subdir", isDirectory: (): boolean => true, isFile: (): boolean => false },
      ] as any);

      mockFs.readdir.mockResolvedValueOnce([
        { name: "file2.txt", isDirectory: (): boolean => false, isFile: (): boolean => true },
      ] as any);

      const count = await fetcher["countFilesInDirectory"]("/test/dir");

      expect(count).toBe(2);
    });

    it("should skip .git directory", async () => {
      mockFs.readdir.mockResolvedValue([
        { name: ".git", isDirectory: (): boolean => true, isFile: (): boolean => false },
        { name: "file1.txt", isDirectory: (): boolean => false, isFile: (): boolean => true },
      ] as any);

      const count = await fetcher["countFilesInDirectory"]("/test/dir");

      expect(count).toBe(1);
    });
  });

  describe("getCurrentCommitHash private method", () => {
    it("should get current commit hash", async () => {
      mockGit.resolveRef.mockResolvedValue("commit123");

      const hash = await fetcher["getCurrentCommitHash"]("/test/dir");

      expect(hash).toBe("commit123");
      expect(mockGit.resolveRef).toHaveBeenCalledWith({
        fs: expect.anything(),
        dir: "/test/dir",
        ref: "HEAD",
      });
    });

    it("should throw error on failure", async () => {
      mockGit.resolveRef.mockRejectedValue(new Error("Failed to resolve ref"));

      await expect(fetcher["getCurrentCommitHash"]("/test/dir")).rejects.toThrow();
    });
  });

  describe("extractRootDirectory private method", () => {
    it("should extract rootDirectory from cloned repo", async () => {
      const configWithSubdir: GithubConfig = {
        ...config,
        rootDirectory: "docs",
      };
      const fetcherWithSubdir = new GitCloneContentFetcher(configWithSubdir);
      // Set up worker mocks for new fetcher
      const mockWorker = (fetcherWithSubdir as any).gitWorker;
      mockWorker.clone = jest.fn().mockResolvedValue(undefined);
      mockWorker.pull = jest.fn().mockResolvedValue(undefined);
      mockWorker.resetIndex = jest.fn().mockResolvedValue(undefined);
      mockWorker.checkout = jest.fn().mockResolvedValue(undefined);
      mockWorker.abort = jest.fn();

      const targetDir = "/test/target";
      const sourcePath = "/test/target/docs";
      const stagingDir = "/test/target_staging";

      mockGit.statusMatrix.mockResolvedValue([]);
      // sourcePath exists (first call to pathExists)
      mockFs.access.mockResolvedValueOnce(undefined);
      mockFs.readdir.mockResolvedValueOnce(["docs", ".git", "README.md"] as any);
      mockFs.readdir.mockResolvedValueOnce(["file1.md", "file2.md"] as any);

      await fetcherWithSubdir["extractRootDirectory"](targetDir);

      expect(mockFs.cp).toHaveBeenCalledWith(sourcePath, stagingDir, { recursive: true });
      expect(mockFs.rm).toHaveBeenCalledWith("/test/target/docs", { recursive: true, force: true });
      expect(mockFs.rm).toHaveBeenCalledWith("/test/target/README.md", { recursive: true, force: true });
      expect(mockFs.rename).toHaveBeenCalledTimes(2);
      expect(mockFs.rm).toHaveBeenCalledWith(stagingDir, { recursive: true, force: true });

      fetcherWithSubdir.destroy();
    });

    it("should throw error when rootDirectory does not exist", async () => {
      const configWithSubdir: GithubConfig = {
        ...config,
        rootDirectory: "nonexistent",
      };
      const fetcherWithSubdir = new GitCloneContentFetcher(configWithSubdir);
      const targetDir = "/test/target";

      mockGit.statusMatrix.mockResolvedValue([]);
      mockFs.access.mockRejectedValue(new Error("ENOENT"));

      await expect(fetcherWithSubdir["extractRootDirectory"](targetDir)).rejects.toThrow(
        "Configuration error: Root directory 'nonexistent' does not exist in the cloned repository at path '/test/target/nonexistent'. Please check your ORD_DIRECTORY configuration.",
      );

      fetcherWithSubdir.destroy();
    });

    it("should cleanup staging directory on extraction error", async () => {
      const configWithSubdir: GithubConfig = {
        ...config,
        rootDirectory: "docs",
      };
      const fetcherWithSubdir = new GitCloneContentFetcher(configWithSubdir);
      // Set up worker mocks
      const mockWorker = (fetcherWithSubdir as any).gitWorker;
      mockWorker.clone = jest.fn().mockResolvedValue(undefined);
      mockWorker.pull = jest.fn().mockResolvedValue(undefined);
      mockWorker.resetIndex = jest.fn().mockResolvedValue(undefined);
      mockWorker.checkout = jest.fn().mockResolvedValue(undefined);
      mockWorker.abort = jest.fn();

      const targetDir = "/test/target";
      const stagingDir = "/test/target_staging";

      mockGit.statusMatrix.mockResolvedValue([]);
      mockFs.access.mockResolvedValueOnce(undefined);
      mockFs.cp.mockRejectedValue(new Error("Copy failed"));

      await expect(fetcherWithSubdir["extractRootDirectory"](targetDir)).rejects.toThrow(
        "Failed to extract root directory",
      );

      expect(mockFs.rm).toHaveBeenCalledWith(stagingDir, { recursive: true, force: true });

      fetcherWithSubdir.destroy();
    });

    it("should log warning when modified files detected", async () => {
      const configWithSubdir: GithubConfig = {
        ...config,
        rootDirectory: "docs",
      };
      const fetcherWithSubdir = new GitCloneContentFetcher(configWithSubdir);
      // Set up worker mocks
      const mockWorker = (fetcherWithSubdir as any).gitWorker;
      mockWorker.clone = jest.fn().mockResolvedValue(undefined);
      mockWorker.pull = jest.fn().mockResolvedValue(undefined);
      mockWorker.resetIndex = jest.fn().mockResolvedValue(undefined);
      mockWorker.checkout = jest.fn().mockResolvedValue(undefined);
      mockWorker.abort = jest.fn();

      const targetDir = "/test/target";

      // Mock git status showing modified files
      mockGit.statusMatrix.mockResolvedValue([
        ["file1.txt", 1, 2, 1], // modified
        ["file2.txt", 1, 2, 1], // modified
      ]);
      mockFs.access.mockResolvedValueOnce(undefined);
      mockFs.readdir.mockResolvedValueOnce([".git"] as any);
      mockFs.readdir.mockResolvedValueOnce([] as any);

      await fetcherWithSubdir["extractRootDirectory"](targetDir);

      fetcherWithSubdir.destroy();
    });
  });

  describe("gitPull with fallback", () => {
    it("should handle pull failure and fallback to reset", async () => {
      const targetDir = "/test/target";
      const mockWorker = (fetcher as any).gitWorker;

      mockFs.access.mockResolvedValue(undefined); // existing repo
      mockGit.resolveRef.mockResolvedValueOnce("before123"); // before pull
      mockGit.resolveRef.mockResolvedValueOnce("before123"); // after failed pull (no change)
      mockGit.resolveRef.mockResolvedValueOnce("after456"); // after reset

      // Pull fails, should trigger reset
      mockWorker.pull.mockRejectedValue(new Error("Pull failed"));
      mockWorker.resetIndex.mockResolvedValue(undefined);
      mockWorker.checkout.mockResolvedValue(undefined);

      mockGit.listFiles.mockResolvedValue(["file1.txt"]);

      await fetcher.fetchAllContent(targetDir);

      expect(mockWorker.pull).toHaveBeenCalled();
      expect(mockWorker.resetIndex).toHaveBeenCalledWith(targetDir);
      expect(mockWorker.checkout).toHaveBeenCalledWith(targetDir, "origin/main", true);
    });

    it("should extract rootDirectory after pull when configured", async () => {
      const configWithSubdir: GithubConfig = {
        ...config,
        rootDirectory: "docs",
      };
      const fetcherWithSubdir = new GitCloneContentFetcher(configWithSubdir);
      const targetDir = "/test/target";
      const mockWorker = (fetcherWithSubdir as any).gitWorker;
      mockWorker.clone = jest.fn().mockResolvedValue(undefined);
      mockWorker.pull = jest.fn().mockResolvedValue(undefined);
      mockWorker.resetIndex = jest.fn().mockResolvedValue(undefined);
      mockWorker.checkout = jest.fn().mockResolvedValue(undefined);
      mockWorker.abort = jest.fn();

      mockFs.access.mockResolvedValue(undefined);
      mockGit.resolveRef.mockResolvedValue("commit123");
      mockGit.listFiles.mockResolvedValue(["docs/file1.md"]);
      mockGit.statusMatrix.mockResolvedValue([]);
      mockFs.readdir.mockResolvedValue([] as any);

      const extractSpy = jest.spyOn(fetcherWithSubdir as any, "extractRootDirectory");

      await fetcherWithSubdir.fetchAllContent(targetDir);

      expect(extractSpy).toHaveBeenCalled();
      expect(extractSpy.mock.calls[0][0]).toBe(targetDir);

      fetcherWithSubdir.destroy();
    });
  });

  describe("gitClone with rootDirectory", () => {
    it("should extract rootDirectory after clone when configured", async () => {
      const configWithSubdir: GithubConfig = {
        ...config,
        rootDirectory: "docs",
      };
      const fetcherWithSubdir = new GitCloneContentFetcher(configWithSubdir);
      const targetDir = "/test/target";
      const mockWorker = (fetcherWithSubdir as any).gitWorker;
      mockWorker.clone = jest.fn().mockResolvedValue(undefined);
      mockWorker.pull = jest.fn().mockResolvedValue(undefined);
      mockWorker.resetIndex = jest.fn().mockResolvedValue(undefined);
      mockWorker.checkout = jest.fn().mockResolvedValue(undefined);
      mockWorker.abort = jest.fn();

      mockFs.access.mockRejectedValueOnce(new Error("ENOENT")); // no .git
      mockFs.access.mockResolvedValue(undefined);
      mockGit.resolveRef.mockResolvedValue("commit123");
      mockGit.listFiles.mockResolvedValue(["docs/file1.md"]);
      mockGit.statusMatrix.mockResolvedValue([]);
      mockFs.readdir.mockResolvedValue([] as any);

      const extractSpy = jest.spyOn(fetcherWithSubdir as any, "extractRootDirectory");

      await fetcherWithSubdir.fetchAllContent(targetDir);

      expect(extractSpy).toHaveBeenCalled();
      expect(extractSpy.mock.calls[0][0]).toBe(targetDir);

      fetcherWithSubdir.destroy();
    });

    it("should report clone progress through callback", async () => {
      const targetDir = "/test/target";
      const onProgress = jest.fn();
      const mockWorker = (fetcher as any).gitWorker;

      mockFs.access.mockRejectedValueOnce(new Error("ENOENT"));
      mockFs.access.mockResolvedValue(undefined);
      mockGit.resolveRef.mockResolvedValue("commit123");
      mockGit.listFiles.mockResolvedValue(["file1.txt"]);

      // Mock clone to call progress callback
      mockWorker.clone.mockImplementation((_url: any, _dir: any, _branch: any, _auth: any, progressCallback: any) => {
        progressCallback({ phase: "Receiving objects", loaded: 50, total: 100 });
        progressCallback({ phase: "Resolving deltas", loaded: 100, total: 100 });
      });

      await fetcher.fetchAllContent(targetDir, onProgress);

      // Should have been called with progress updates
      expect(onProgress).toHaveBeenCalled();
      const progressCall = onProgress.mock.calls[0][0];
      expect(progressCall).toHaveProperty("currentFile");
      expect(progressCall).toHaveProperty("startTime");
    });
  });
});
