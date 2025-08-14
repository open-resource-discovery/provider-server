import { fetchGitHubFile, getGithubDirectoryContents, getDirectoryHash, GitHubContentItem } from "src/util/github.js";
import { GitHubInstance } from "src/model/github.js";
import {
  GitHubFileNotFoundError,
  GitHubNetworkError,
  GitHubAccessError,
  GitHubDirectoryNotFoundError,
} from "src/model/error/GithubErrors.js";
import { Buffer } from "buffer";

describe("GitHub Util", () => {
  beforeAll(() => {
    const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = mockFetch;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockInstance: GitHubInstance = {
    host: "https://api.github.com",
    repo: "owner/repo",
    branch: "main",
  };

  const mockToken = "test-token";
  const fileContent = "Decoded file content";
  const fileContentBase64 = Buffer.from(fileContent).toString("base64");
  const filePath = "path/to/test.json";
  const fileSha = "abc123def456";
  const contentsUrl = `https://api.github.com/repos/owner/repo/contents/${filePath}?ref=main`;
  const blobUrl = `https://api.github.com/repos/owner/repo/git/blobs/${fileSha}`;

  it("should fetch small GitHub file successfully (content in first response)", async () => {
    const mockMetadataResponse: GitHubContentItem = {
      name: "test.json",
      path: filePath,
      sha: fileSha,
      size: 100,
      type: "file",
      content: fileContentBase64,
      encoding: "base64",
    };
    const mockFetchResponse: Partial<Response> = {
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(mockMetadataResponse),
    };

    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValueOnce(mockFetchResponse as Response);

    const result = await fetchGitHubFile(mockInstance, filePath, mockToken);

    expect(result).toEqual(fileContent);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(contentsUrl, {
      headers: { Authorization: `Token ${mockToken}` },
    });
  });

  it("should fetch large GitHub file successfully (content via blob API)", async () => {
    const mockMetadataResponse: GitHubContentItem = {
      name: "test.json",
      path: filePath,
      sha: fileSha,
      size: 2 * 1024 * 1024,
      type: "file",
    };
    const mockBlobResponseData = {
      sha: fileSha,
      size: 2 * 1024 * 1024,
      content: fileContentBase64,
      encoding: "base64",
    };

    const mockFetchMetadataResponse: Partial<Response> = {
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(mockMetadataResponse),
    };
    const mockFetchBlobResponse: Partial<Response> = {
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(mockBlobResponseData),
    };

    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch
      .mockResolvedValueOnce(mockFetchMetadataResponse as Response)
      .mockResolvedValueOnce(mockFetchBlobResponse as Response);

    const result = await fetchGitHubFile(mockInstance, filePath, mockToken);

    expect(result).toEqual(fileContent);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(1, contentsUrl, {
      headers: { Authorization: `Token ${mockToken}` },
    });
    expect(mockFetch).toHaveBeenNthCalledWith(2, blobUrl, {
      headers: { Authorization: `Token ${mockToken}` },
    });
  });

  it("should throw GitHubFileNotFoundError when file is not found (404 on metadata fetch)", async () => {
    const mockResponse: Partial<Response> = {
      ok: false,
      status: 404,
      statusText: "Not Found",
    };
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValueOnce(mockResponse as Response);

    await expect(fetchGitHubFile(mockInstance, "nonexistent.json", mockToken)).rejects.toThrow(GitHubFileNotFoundError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/contents/nonexistent.json?ref=main",
      expect.any(Object),
    );
  });

  it("should throw GitHubNetworkError on network errors during metadata fetch", async () => {
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(fetchGitHubFile(mockInstance, filePath, mockToken)).rejects.toThrow(GitHubNetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(contentsUrl, expect.any(Object));
  });

  it("should throw GitHubAccessError on invalid JSON response during metadata fetch", async () => {
    const mockResponse: Partial<Response> = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn().mockRejectedValue(new SyntaxError("Invalid JSON")),
    };
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValueOnce(mockResponse as Response);

    await expect(fetchGitHubFile(mockInstance, filePath, mockToken)).rejects.toThrow(GitHubAccessError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(contentsUrl, expect.any(Object));
  });

  it("should throw GitHubAccessError on empty response during metadata fetch", async () => {
    const mockResponse: Partial<Response> = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn().mockResolvedValue(null),
    };
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValueOnce(mockResponse as Response);

    await expect(fetchGitHubFile(mockInstance, filePath, mockToken)).rejects.toThrow(GitHubAccessError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(contentsUrl, expect.any(Object));
  });

  it("should throw GitHubAccessError on unauthorized access during metadata fetch", async () => {
    const mockResponse: Partial<Response> = {
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    };
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValueOnce(mockResponse as Response);

    await expect(fetchGitHubFile(mockInstance, filePath, mockToken)).rejects.toThrow(GitHubAccessError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(contentsUrl, expect.any(Object));
  });

  it("should include proper error details in GitHubAccessError from metadata fetch", async () => {
    const mockResponse: Partial<Response> = {
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    };
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValueOnce(mockResponse as Response);

    try {
      await fetchGitHubFile(mockInstance, filePath, mockToken);

      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubAccessError);
      if (error instanceof GitHubAccessError) {
        expect(error.errorItem.target).toBe(filePath);
        expect(error.errorItem.details).toBeDefined();
        expect(error.errorItem.details![0].code).toBe(`HTTP_401`);
      }
    }
  });

  describe("getGithubDirectoryContents", () => {
    const directoryPath = "src/components";
    const directoryUrl = `https://api.github.com/repos/owner/repo/contents/${directoryPath}?ref=main`;

    const mockDirectoryContents: GitHubContentItem[] = [
      {
        name: "Button.tsx",
        path: "src/components/Button.tsx",
        type: "file",
        sha: "file123sha",
        size: 1024,
      },
      {
        name: "Modal.tsx",
        path: "src/components/Modal.tsx",
        type: "file",
        sha: "file456sha",
        size: 2048,
      },
      {
        name: "utils",
        path: "src/components/utils",
        type: "dir",
        sha: "dir789sha",
        size: 0,
      },
    ];

    const mockSubdirectoryContents: GitHubContentItem[] = [
      {
        name: "helpers.ts",
        path: "src/components/utils/helpers.ts",
        type: "file",
        sha: "sub123sha",
        size: 512,
      },
      {
        name: "constants.ts",
        path: "src/components/utils/constants.ts",
        type: "file",
        sha: "sub456sha",
        size: 256,
      },
    ];

    it("should fetch directory contents recursively by default", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      // Mock main directory response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockDirectoryContents),
      } as unknown as Response);

      // Mock subdirectory response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockSubdirectoryContents),
      } as unknown as Response);

      const result = await getGithubDirectoryContents(mockInstance, directoryPath, mockToken);

      expect(result).toHaveLength(5); // 3 main items + 2 subdirectory items
      expect(result).toContainEqual(mockDirectoryContents[0]); // Button.tsx
      expect(result).toContainEqual(mockDirectoryContents[1]); // Modal.tsx
      expect(result).toContainEqual(mockDirectoryContents[2]); // utils dir
      expect(result).toContainEqual(mockSubdirectoryContents[0]); // helpers.ts
      expect(result).toContainEqual(mockSubdirectoryContents[1]); // constants.ts

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(1, directoryUrl, {
        headers: { Authorization: `Token ${mockToken}` },
      });
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://api.github.com/repos/owner/repo/contents/src/components/utils?ref=main",
        { headers: { Authorization: `Token ${mockToken}` } },
      );
    });

    it("should fetch directory contents non-recursively when specified", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockDirectoryContents),
      } as unknown as Response);

      const result = await getGithubDirectoryContents(mockInstance, directoryPath, mockToken, false);

      // Should only return files, not directories or subdirectory contents
      expect(result).toHaveLength(2);
      expect(result).toContainEqual(mockDirectoryContents[0]); // Button.tsx
      expect(result).toContainEqual(mockDirectoryContents[1]); // Modal.tsx
      expect(result).not.toContainEqual(mockDirectoryContents[2]); // utils dir should be filtered out

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(directoryUrl, {
        headers: { Authorization: `Token ${mockToken}` },
      });
    });

    it("should work without authentication token", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockDirectoryContents.filter((item) => item.type === "file")),
      } as unknown as Response);

      const result = await getGithubDirectoryContents(mockInstance, directoryPath, undefined, false);

      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(directoryUrl, {});
    });

    it("should throw GitHubDirectoryNotFoundError when directory is not found", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as unknown as Response);

      await expect(getGithubDirectoryContents(mockInstance, "nonexistent", mockToken)).rejects.toThrow(
        GitHubDirectoryNotFoundError,
      );
    });

    it("should throw GitHubDirectoryNotFoundError when response is a file instead of directory", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      const fileResponse: GitHubContentItem = {
        name: "file.txt",
        path: "src/file.txt",
        type: "file",
        sha: "fileSha123",
        size: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(fileResponse),
      } as unknown as Response);

      await expect(getGithubDirectoryContents(mockInstance, "src/file.txt", mockToken)).rejects.toThrow(
        GitHubDirectoryNotFoundError,
      );
    });

    it("should handle empty directory", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([]),
      } as unknown as Response);

      const result = await getGithubDirectoryContents(mockInstance, directoryPath, mockToken);

      expect(result).toHaveLength(0);
    });

    it("should handle network errors during directory fetch", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockRejectedValueOnce(new TypeError("Network error"));

      await expect(getGithubDirectoryContents(mockInstance, directoryPath, mockToken)).rejects.toThrow(
        GitHubNetworkError,
      );
    });

    it("should handle subdirectory fetch errors during recursive fetch", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      // Mock successful main directory response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockDirectoryContents),
      } as unknown as Response);

      // Mock failed subdirectory response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      } as unknown as Response);

      await expect(getGithubDirectoryContents(mockInstance, directoryPath, mockToken)).rejects.toThrow(
        GitHubAccessError,
      );
    });
  });

  describe("getDirectoryHash", () => {
    const directoryPath = "src/components";

    it("should get hash for regular directory", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      const mockParentContents: GitHubContentItem[] = [
        {
          name: "components",
          path: "src/components",
          type: "dir",
          sha: "expectedDirectorySha123",
          size: 0,
        },
        {
          name: "utils",
          path: "src/utils",
          type: "dir",
          sha: "otherDirSha456",
          size: 0,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockParentContents),
      } as unknown as Response);

      const result = await getDirectoryHash(mockInstance, directoryPath, mockToken);

      expect(result).toBe("expectedDirectorySha123");
      expect(mockFetch).toHaveBeenCalledWith("https://api.github.com/repos/owner/repo/contents/src?ref=main", {
        headers: { Authorization: `Token ${mockToken}` },
      });
    });

    it("should return undefined for root directory (edge case)", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      const mockRootContents: GitHubContentItem[] = [
        {
          name: "src",
          path: "src",
          type: "dir",
          sha: "srcSha123",
          size: 0,
        },
        {
          name: "README.md",
          path: "README.md",
          type: "file",
          sha: "readmeSha123",
          size: 1024,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockRootContents),
      } as unknown as Response);

      // Root path "/" has empty base name, so no match is found
      const result = await getDirectoryHash(mockInstance, "/", mockToken);

      expect(result).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith("https://api.github.com/repos/owner/repo/contents/?ref=main", {
        headers: { Authorization: `Token ${mockToken}` },
      });
    });

    it("should return undefined for empty directory path (edge case)", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      const mockBranchContents: GitHubContentItem[] = [
        {
          name: "src",
          path: "src",
          type: "dir",
          sha: "srcSha789",
          size: 0,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockBranchContents),
      } as unknown as Response);

      // Empty path "" has empty base name, so no match is found
      const result = await getDirectoryHash(mockInstance, "", mockToken);

      expect(result).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith("https://api.github.com/repos/owner/repo/contents/?ref=main", {
        headers: { Authorization: `Token ${mockToken}` },
      });
    });

    it("should return undefined when directory is not found", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      const mockContents: GitHubContentItem[] = [
        {
          name: "other-dir",
          path: "src/other-dir",
          type: "dir",
          sha: "otherSha123",
          size: 0,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockContents),
      } as unknown as Response);

      const result = await getDirectoryHash(mockInstance, "src/nonexistent", mockToken);

      expect(result).toBeUndefined();
    });

    it("should work without authentication token", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      const mockContents: GitHubContentItem[] = [
        {
          name: "components",
          path: "src/components",
          type: "dir",
          sha: "publicDirSha789",
          size: 0,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockContents),
      } as unknown as Response);

      const result = await getDirectoryHash(mockInstance, directoryPath);

      expect(result).toBe("publicDirSha789");
      expect(mockFetch).toHaveBeenCalledWith("https://api.github.com/repos/owner/repo/contents/src?ref=main", {});
    });

    it("should handle nested directory paths correctly", async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

      const mockContents: GitHubContentItem[] = [
        {
          name: "deep",
          path: "src/components/ui/deep",
          type: "dir",
          sha: "deepDirSha999",
          size: 0,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockContents),
      } as unknown as Response);

      const result = await getDirectoryHash(mockInstance, "src/components/ui/deep", mockToken);

      expect(result).toBe("deepDirSha999");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo/contents/src/components/ui?ref=main",
        { headers: { Authorization: `Token ${mockToken}` } },
      );
    });
  });
});
