import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { fetchGitHubFile } from "src/util/github.js";
import { GitHubFileResponse, GitHubInstance } from "src/model/github.js";
import { GitHubFileNotFoundError, GitHubNetworkError, GitHubAccessError } from "src/model/error/GithubErrors.js";

describe("GitHub", () => {
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

  it("should fetch GitHub file successfully", async () => {
    const mockFileContent: GitHubFileResponse = {
      name: "test.json",
      path: "test.json",
      sha: "abc123",
      size: 100,
      url: "https://api.github.com/repos/owner/repo/contents/test.json",
      html_url: "https://github.com/owner/repo/blob/main/test.json",
      git_url: "https://api.github.com/repos/owner/repo/git/blobs/abc123",
      download_url: "https://raw.githubusercontent.com/owner/repo/main/test.json",
      type: "file",
      content: "base64encodedcontent",
      encoding: "base64",
    };
    const mockResponse: Partial<Response> = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn<() => Promise<unknown>>().mockResolvedValue(mockFileContent),
    };

    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValue(mockResponse as Response);

    const result = await fetchGitHubFile<GitHubFileResponse>(mockInstance, "test.json", "token");

    expect(result).toEqual(mockFileContent);
    expect(mockFetch).toHaveBeenCalledWith("https://api.github.com/repos/owner/repo/contents/test.json?ref=main", {
      headers: { Authorization: "Token token" },
    });
  });

  it("should throw GitHubFileNotFoundError when file is not found", async () => {
    const mockResponse: Partial<Response> = {
      ok: false,
      status: 404,
      statusText: "Not Found",
    };
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValue(mockResponse as Response);
    await expect(fetchGitHubFile<GitHubFileResponse>(mockInstance, "nonexistent.json", "token")).rejects.toThrow(
      GitHubFileNotFoundError,
    );
  });

  it("should throw GitHubNetworkError on network errors", async () => {
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchGitHubFile<GitHubFileResponse>(mockInstance, "test.json", "token")).rejects.toThrow(
      GitHubNetworkError,
    );
  });

  it("should throw GitHubAccessError on invalid JSON response", async () => {
    const mockResponse: Partial<Response> = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error("Invalid JSON")),
    };
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValue(mockResponse as Response);
    await expect(fetchGitHubFile<GitHubFileResponse>(mockInstance, "test.json", "token")).rejects.toThrow(
      GitHubAccessError,
    );
  });

  it("should throw GitHubAccessError on empty response", async () => {
    const mockResponse: Partial<Response> = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
    };
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValue(mockResponse as Response);
    await expect(fetchGitHubFile<GitHubFileResponse>(mockInstance, "test.json", "token")).rejects.toThrow(
      GitHubAccessError,
    );
  });

  it("should throw GitHubAccessError on unauthorized access", async () => {
    const mockResponse: Partial<Response> = {
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    };
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValue(mockResponse as Response);
    await expect(fetchGitHubFile<GitHubFileResponse>(mockInstance, "test.json", "token")).rejects.toThrow(
      GitHubAccessError,
    );
  });

  it("should include proper error details in GitHubAccessError", async () => {
    const mockResponse: Partial<Response> = {
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    };
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValue(mockResponse as Response);
    try {
      await fetchGitHubFile<GitHubFileResponse>(mockInstance, "test.json", "token");
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubAccessError);
      if (error instanceof GitHubAccessError) {
        expect(error.errorItem.target).toBe("test.json");
        expect(error.errorItem.details).toBeDefined();
        expect(error.errorItem.details![0].code).toBe(`HTTP_401`);
      }
    }
  });
});
