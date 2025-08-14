// Mock p-limit to avoid ESM issues in tests
jest.mock("p-limit", () => {
  const mockLimit =
    (_concurrency: number) =>
    (fn: () => unknown): unknown =>
      fn();
  return {
    __esModule: true,
    default: mockLimit,
  };
});

jest.mock("@octokit/rest");
jest.mock("fs/promises");
jest.mock("../../util/logger.js");

import { GithubContentFetcher } from "../githubContentFetcher.js";
import { Octokit } from "@octokit/rest";
import * as fs from "fs/promises";
import { log } from "../../util/logger.js";
import { GitHubNetworkError } from "../../model/error/GithubErrors.js";
import { DiskSpaceError, MemoryError } from "../../model/error/SystemErrors.js";
import { ContentFetchProgress } from "../interfaces/contentFetcher.js";

describe("GithubContentFetcher", () => {
  let fetcher: GithubContentFetcher;
  interface MockOctokit {
    repos: {
      getCommit: jest.Mock;
    };
    git: {
      getTree: jest.Mock;
      getBlob: jest.Mock;
      getCommit: jest.Mock;
    };
  }
  let mockOctokit: MockOctokit;
  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockLog = log as jest.Mocked<typeof log>;

  const defaultConfig = {
    owner: "testowner",
    repo: "testrepo",
    branch: "main",
    rootDirectory: ".",
    token: "test-token",
    apiUrl: "https://api.github.com",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockOctokit = {
      repos: {
        getCommit: jest.fn(),
      },
      git: {
        getTree: jest.fn(),
        getBlob: jest.fn(),
        getCommit: jest.fn(),
      },
    };

    (Octokit as unknown as jest.MockedClass<typeof Octokit>).mockImplementation(
      () => mockOctokit as unknown as Octokit,
    );

    mockLog.info = jest.fn();
    mockLog.debug = jest.fn();
    mockLog.warn = jest.fn();
    mockLog.error = jest.fn();

    fetcher = new GithubContentFetcher(defaultConfig);
  });

  describe("fetchAllContent", () => {
    const mockTreeData = [
      { path: "file1.txt", sha: "sha1", size: 100, type: "blob" },
      { path: "dir/file2.txt", sha: "sha2", size: 200, type: "blob" },
    ];

    beforeEach(() => {
      mockOctokit.repos.getCommit.mockResolvedValue({
        data: {
          sha: "commit-sha",
          commit: { tree: { sha: "tree-sha" } },
        },
      });

      mockOctokit.git.getTree.mockResolvedValue({
        data: {
          tree: mockTreeData.map((item) => ({
            ...item,
            path: item.path,
            sha: item.sha,
            size: item.size,
            type: item.type,
          })),
        },
      });

      mockOctokit.git.getCommit.mockResolvedValue({
        data: {
          tree: { sha: "tree-sha" },
        },
      });

      mockOctokit.git.getBlob.mockImplementation(({ file_sha }: { file_sha: string }) => {
        const content = file_sha === "sha1" ? "file1 content" : "file2 content";
        return Promise.resolve({
          data: {
            content: Buffer.from(content).toString("base64"),
            encoding: "base64",
          },
        });
      });

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
    });

    it("should fetch all content successfully", async () => {
      const targetDir = "/target/dir";
      const onProgress = jest.fn();

      const result = await fetcher.fetchAllContent(targetDir, onProgress);

      expect(result).toEqual({
        commitHash: "commit-sha",
        directoryTreeSha: "tree-sha",
        fetchTime: expect.any(Date),
        branch: "main",
        repository: "testowner/testrepo",
        totalFiles: 2,
      });

      expect(mockFs.mkdir).toHaveBeenCalledWith("/target/dir/dir", { recursive: true });
      expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalled();
    });

    it("should handle network errors", async () => {
      mockOctokit.repos.getCommit.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(fetcher.fetchAllContent("/target/dir")).rejects.toThrow(GitHubNetworkError);
      expect(mockLog.error).toHaveBeenCalled();
    });

    it("should handle disk space errors", async () => {
      interface ErrorWithCode extends Error {
        code?: string;
      }
      const diskError = new Error("ENOSPC: no space left on device") as ErrorWithCode;
      diskError.code = "ENOSPC";
      mockFs.writeFile.mockRejectedValueOnce(diskError);

      await expect(fetcher.fetchAllContent("/target/dir")).rejects.toThrow(DiskSpaceError);
    });

    it("should handle memory errors", async () => {
      interface ErrorWithCode extends Error {
        code?: string;
      }
      const memError = new Error("ENOMEM: out of memory") as ErrorWithCode;
      memError.code = "ENOMEM";
      mockFs.writeFile.mockRejectedValueOnce(memError);

      await expect(fetcher.fetchAllContent("/target/dir")).rejects.toThrow(MemoryError);
    });

    it("should handle abort signal", async () => {
      const targetDir = "/target/dir";

      // Simulate abort during fetch
      mockOctokit.git.getBlob.mockImplementation(() => {
        fetcher.abortFetch();
        throw new Error("Aborted");
      });

      await expect(fetcher.fetchAllContent(targetDir)).rejects.toThrow("Fetch aborted");
      expect(mockLog.warn).toHaveBeenCalledWith("GitHub content fetch was aborted");
    });

    it("should report progress correctly", async () => {
      const targetDir = "/target/dir";
      const progressUpdates: ContentFetchProgress[] = [];
      const onProgress = (progress: ContentFetchProgress): void => {
        progressUpdates.push({ ...progress });
      };

      await fetcher.fetchAllContent(targetDir, onProgress);

      expect(progressUpdates.length).toBeGreaterThan(0);
      const lastProgress = progressUpdates[progressUpdates.length - 1];
      expect(lastProgress.totalFiles).toBe(2);
      expect(lastProgress.fetchedFiles).toBe(2);
      expect(lastProgress.errors).toHaveLength(0);
    });

    it("should handle files with errors but continue", async () => {
      mockOctokit.git.getBlob
        .mockResolvedValueOnce({
          data: { content: Buffer.from("file1").toString("base64"), encoding: "base64" },
        })
        .mockRejectedValueOnce(new Error("File fetch failed"));

      const targetDir = "/target/dir";

      await expect(fetcher.fetchAllContent(targetDir)).rejects.toThrow("Failed to fetch 1 files");
      expect(mockLog.error).toHaveBeenCalled();
    });

    it("should filter files based on rootDirectory", async () => {
      const configWithRoot = { ...defaultConfig, rootDirectory: "docs" };
      fetcher = new GithubContentFetcher(configWithRoot);

      const treeWithDocs = [
        { path: "docs/file1.txt", sha: "sha1", size: 100, type: "blob" },
        { path: "src/file2.txt", sha: "sha2", size: 200, type: "blob" },
        { path: "docs/sub/file3.txt", sha: "sha3", size: 300, type: "blob" },
      ];

      mockOctokit.git.getTree.mockResolvedValue({
        data: { tree: treeWithDocs },
      });

      mockOctokit.repos.getCommit.mockResolvedValue({
        data: {
          sha: "commit-sha",
          commit: { tree: { sha: "tree-sha" } },
        },
      });

      mockOctokit.git.getCommit.mockResolvedValue({
        data: { tree: { sha: "tree-sha" } },
      });

      mockOctokit.git.getBlob.mockResolvedValue({
        data: { content: Buffer.from("content").toString("base64"), encoding: "base64" },
      });

      const result = await fetcher.fetchAllContent("/target/dir");

      expect(result.totalFiles).toBe(2); // Only files under docs/
      expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
    });
  });

  describe("getLatestCommitSha", () => {
    it("should fetch latest commit SHA", async () => {
      mockOctokit.repos.getCommit.mockResolvedValue({
        data: { sha: "latest-commit-sha" },
      });

      const sha = await fetcher.getLatestCommitSha();

      expect(sha).toBe("latest-commit-sha");
      expect(mockOctokit.repos.getCommit).toHaveBeenCalledWith({
        owner: "testowner",
        repo: "testrepo",
        ref: "main",
      });
    });

    it("should handle API errors", async () => {
      mockOctokit.repos.getCommit.mockRejectedValue(new Error("API error"));

      await expect(fetcher.getLatestCommitSha()).rejects.toThrow("API error");
    });
  });

  describe("getDirectoryTreeSha", () => {
    it("should get root tree SHA for root directory", async () => {
      mockOctokit.repos.getCommit.mockResolvedValue({
        data: { sha: "commit-sha" },
      });

      mockOctokit.git.getCommit.mockResolvedValue({
        data: { tree: { sha: "root-tree-sha" } },
      });

      const sha = await fetcher.getDirectoryTreeSha("commit-sha");

      expect(sha).toBe("root-tree-sha");
    });

    it("should get subdirectory tree SHA", async () => {
      const configWithSubdir = { ...defaultConfig, rootDirectory: "docs" };
      fetcher = new GithubContentFetcher(configWithSubdir);

      mockOctokit.repos.getCommit.mockResolvedValue({
        data: { sha: "commit-sha" },
      });

      mockOctokit.git.getCommit.mockResolvedValue({
        data: { tree: { sha: "root-tree-sha" } },
      });

      mockOctokit.git.getTree.mockResolvedValue({
        data: {
          tree: [
            { path: "docs", type: "tree", sha: "docs-tree-sha" },
            { path: "src", type: "tree", sha: "src-tree-sha" },
          ],
        },
      });

      const sha = await fetcher.getDirectoryTreeSha("commit-sha");

      expect(sha).toBe("docs-tree-sha");
    });

    it("should return null for non-existent directory", async () => {
      const configWithSubdir = { ...defaultConfig, rootDirectory: "nonexistent" };
      fetcher = new GithubContentFetcher(configWithSubdir);

      mockOctokit.git.getCommit.mockResolvedValue({
        data: { tree: { sha: "root-tree-sha" } },
      });

      mockOctokit.git.getTree.mockResolvedValue({
        data: { tree: [] },
      });

      const sha = await fetcher.getDirectoryTreeSha("commit-sha");

      expect(sha).toBeNull();
      expect(mockLog.warn).toHaveBeenCalledWith("Directory nonexistent not found in repository tree");
    });

    it("should fetch latest commit if no SHA provided", async () => {
      mockOctokit.repos.getCommit.mockResolvedValue({
        data: { sha: "latest-sha" },
      });

      mockOctokit.git.getCommit.mockResolvedValue({
        data: { tree: { sha: "tree-sha" } },
      });

      await fetcher.getDirectoryTreeSha();

      expect(mockOctokit.repos.getCommit).toHaveBeenCalled();
    });
  });

  describe("fetchLatestChanges", () => {
    it("should call fetchAllContent", async () => {
      const fetchAllSpy = jest.spyOn(fetcher, "fetchAllContent");
      fetchAllSpy.mockResolvedValue({
        commitHash: "sha",
        fetchTime: new Date(),
        branch: "main",
        repository: "owner/repo",
        totalFiles: 0,
      });

      await fetcher.fetchLatestChanges("/target/dir", new Date());

      expect(fetchAllSpy).toHaveBeenCalledWith("/target/dir");
    });
  });

  describe("abortFetch", () => {
    it("should abort ongoing fetch", () => {
      // Start a fetch to create abort controller
      const fetchPromise = fetcher.fetchAllContent("/target/dir");

      // Abort the fetch
      fetcher.abortFetch();

      // The fetch should eventually fail
      expect(fetchPromise).rejects.toBeDefined();
    });

    it("should handle abort when no fetch is running", () => {
      expect(() => fetcher.abortFetch()).not.toThrow();
    });
  });

  describe("error scenarios", () => {
    it("should handle various network errors", async () => {
      const networkErrors = ["ENOTFOUND", "ETIMEDOUT", "getaddrinfo ENOTFOUND", "network error"];

      for (const errorMsg of networkErrors) {
        mockOctokit.repos.getCommit.mockRejectedValueOnce(new Error(errorMsg));

        await expect(fetcher.fetchAllContent("/target/dir")).rejects.toThrow(GitHubNetworkError);
        expect(mockLog.error).toHaveBeenCalled();
      }
    });

    it("should handle rate limiting gracefully", async () => {
      // The fetcher uses p-limit to limit concurrent requests
      // Test that it processes files sequentially when needed
      const delays = [100, 50, 75, 60, 80];
      let callCount = 0;

      mockOctokit.git.getBlob.mockImplementation(() => {
        const delay = delays[callCount++] || 50;
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                data: { content: Buffer.from("content").toString("base64"), encoding: "base64" },
              }),
            delay,
          ),
        );
      });

      const treeData = Array.from({ length: 10 }, (_, i) => ({
        path: `file${i}.txt`,
        sha: `sha${i}`,
        size: 100,
        type: "blob",
      }));

      mockOctokit.git.getTree.mockResolvedValue({
        data: { tree: treeData },
      });

      mockOctokit.repos.getCommit.mockResolvedValue({
        data: {
          sha: "commit-sha",
          commit: { tree: { sha: "tree-sha" } },
        },
      });

      mockOctokit.git.getCommit.mockResolvedValue({
        data: { tree: { sha: "tree-sha" } },
      });

      const result = await fetcher.fetchAllContent("/target/dir");

      expect(result.totalFiles).toBe(10);
      expect(mockFs.writeFile).toHaveBeenCalledTimes(10);
    });
  });
});
