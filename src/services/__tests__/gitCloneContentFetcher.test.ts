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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockGit: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
});
