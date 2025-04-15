import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { fetchGitHubFile, GitHubContentItem } from "src/util/github.js";
import { GitHubInstance } from "src/model/github.js";
import { GitHubFileNotFoundError, GitHubNetworkError, GitHubAccessError } from "src/model/error/GithubErrors.js";
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
      json: jest.fn<() => Promise<unknown>>().mockResolvedValue(mockMetadataResponse),
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
      json: jest.fn<() => Promise<unknown>>().mockResolvedValue(mockMetadataResponse),
    };
    const mockFetchBlobResponse: Partial<Response> = {
      ok: true,
      status: 200,
      json: jest.fn<() => Promise<unknown>>().mockResolvedValue(mockBlobResponseData),
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
      json: jest.fn<() => Promise<unknown>>().mockRejectedValue(new SyntaxError("Invalid JSON")),
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
      json: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
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
});
