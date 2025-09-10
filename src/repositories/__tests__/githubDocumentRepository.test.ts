import { ORDDocument } from "@open-resource-discovery/specification";
import { GithubDocumentRepository } from "../githubDocumentRepository.js";
import { fetchGitHubFile, getDirectoryHash, getGithubDirectoryContents } from "../../util/github.js";
import { validateOrdDocument } from "../../util/validateOrdDocument.js";
import { log } from "../../util/logger.js";

jest.mock("../../util/github.js");
jest.mock("../../util/validateOrdDocument.js");
jest.mock("../../util/logger.js");

describe("GithubDocumentRepository", () => {
  const mockFetchGitHubFile = fetchGitHubFile as jest.MockedFunction<typeof fetchGitHubFile>;
  const mockGetDirectoryHash = getDirectoryHash as jest.MockedFunction<typeof getDirectoryHash>;
  const mockGetGithubDirectoryContents = getGithubDirectoryContents as jest.MockedFunction<
    typeof getGithubDirectoryContents
  >;
  const mockValidateOrdDocument = validateOrdDocument as jest.MockedFunction<typeof validateOrdDocument>;
  const mockLog = log as jest.Mocked<typeof log>;

  const defaultGithubOpts = {
    githubApiUrl: "https://api.github.com",
    githubRepository: "owner/repo",
    githubBranch: "main",
    githubToken: "test-token",
    customDirectory: "/custom/path",
  };

  let repository: GithubDocumentRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    repository = new GithubDocumentRepository(defaultGithubOpts);
    mockLog.error = jest.fn();
    mockLog.warn = jest.fn();
    mockLog.debug = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("getDocument", () => {
    const validOrdDocument: ORDDocument = {
      openResourceDiscovery: "1.0",
      policyLevel: "sap:core:v1",
    };

    it("should fetch and return a valid ORD document", async () => {
      const jsonContent = JSON.stringify(validOrdDocument);
      mockFetchGitHubFile.mockResolvedValue(jsonContent);
      mockValidateOrdDocument.mockReturnValue(undefined);

      const result = await repository.getDocument("documents/test.json");

      expect(result).toEqual(validOrdDocument);
      expect(mockFetchGitHubFile).toHaveBeenCalledWith(
        { host: "https://api.github.com", repo: "owner/repo", branch: "main" },
        "/custom/path/documents/test.json",
        "test-token",
      );
      expect(mockValidateOrdDocument).toHaveBeenCalledWith(validOrdDocument);
    });

    it("should return null for invalid ORD document", async () => {
      const invalidDoc = { someOtherField: "value" };
      mockFetchGitHubFile.mockResolvedValue(JSON.stringify(invalidDoc));

      const result = await repository.getDocument("documents/invalid.json");

      expect(result).toBeNull();
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("not a valid ORD document"));
    });

    it("should return null and log error on fetch failure", async () => {
      mockFetchGitHubFile.mockRejectedValue(new Error("Network error"));

      const result = await repository.getDocument("documents/test.json");

      expect(result).toBeNull();
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("Error fetching document"));
    });

    it("should return null for invalid JSON", async () => {
      mockFetchGitHubFile.mockResolvedValue("not-valid-json");

      const result = await repository.getDocument("documents/test.json");

      expect(result).toBeNull();
      expect(mockLog.error).toHaveBeenCalled();
    });

    it("should handle validation errors", async () => {
      const jsonContent = JSON.stringify(validOrdDocument);
      mockFetchGitHubFile.mockResolvedValue(jsonContent);
      mockValidateOrdDocument.mockImplementation(() => {
        throw new Error("Validation failed");
      });

      const result = await repository.getDocument("documents/test.json");

      expect(result).toBeNull();
      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe("getDocuments", () => {
    it("should fetch multiple documents from a directory", async () => {
      const doc1: ORDDocument = { openResourceDiscovery: "1.0", policyLevel: "sap:core:v1" };
      const doc2: ORDDocument = { openResourceDiscovery: "1.0", policyLevel: "sap:core:v1" };

      mockGetGithubDirectoryContents.mockResolvedValue([
        { type: "file", path: "/custom/path/docs/file1.json", name: "file1.json", sha: "abc123", size: 100 },
        { type: "file", path: "/custom/path/docs/file2.json", name: "file2.json", sha: "def456", size: 200 },
        { type: "file", path: "/custom/path/docs/readme.md", name: "readme.md", sha: "ghi789", size: 300 },
        { type: "dir", path: "/custom/path/docs/subdir", name: "subdir", sha: "jkl012", size: 0 },
      ]);

      mockFetchGitHubFile.mockResolvedValueOnce(JSON.stringify(doc1)).mockResolvedValueOnce(JSON.stringify(doc2));
      mockValidateOrdDocument.mockReturnValue(undefined);

      const result = await repository.getDocuments("docs");

      expect(result.size).toBe(2);
      expect(result.get("docs/file1.json")).toEqual(doc1);
      expect(result.get("docs/file2.json")).toEqual(doc2);
    });

    it("should handle empty directory", async () => {
      mockGetGithubDirectoryContents.mockResolvedValue([]);

      const result = await repository.getDocuments("empty-dir");

      expect(result.size).toBe(0);
    });

    it("should skip non-JSON files", async () => {
      mockGetGithubDirectoryContents.mockResolvedValue([
        { type: "file", path: "custom/path/docs/file.txt", name: "file.txt", sha: "abc123", size: 100 },
        { type: "file", path: "custom/path/docs/file.xml", name: "file.xml", sha: "def456", size: 200 },
      ]);

      const result = await repository.getDocuments("docs");

      expect(result.size).toBe(0);
      expect(mockFetchGitHubFile).not.toHaveBeenCalled();
    });

    it("should handle listFiles errors gracefully", async () => {
      mockGetGithubDirectoryContents.mockRejectedValue(new Error("API error"));

      const result = await repository.getDocuments("docs");

      expect(result.size).toBe(0);
      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe("getDirectoryHash", () => {
    it("should fetch and cache directory hash", async () => {
      mockGetDirectoryHash.mockResolvedValue("hash123");

      const result1 = await repository.getDirectoryHash("docs");
      expect(result1).toBe("hash123");
      expect(mockGetDirectoryHash).toHaveBeenCalledTimes(1);

      // Second call within throttle period should use cache
      jest.advanceTimersByTime(5000); // 5 seconds
      const result2 = await repository.getDirectoryHash("docs");
      expect(result2).toBe("hash123");
      expect(mockGetDirectoryHash).toHaveBeenCalledTimes(1); // Still 1
      expect(mockLog.debug).toHaveBeenCalledWith(expect.stringContaining("Using cached directory hash"));
    });

    it("should refetch after throttle duration", async () => {
      mockGetDirectoryHash.mockResolvedValueOnce("hash123").mockResolvedValueOnce("hash456");

      const result1 = await repository.getDirectoryHash("docs");
      expect(result1).toBe("hash123");

      // Advance time past throttle duration
      jest.advanceTimersByTime(11000); // 11 seconds

      const result2 = await repository.getDirectoryHash("docs");
      expect(result2).toBe("hash456");
      expect(mockGetDirectoryHash).toHaveBeenCalledTimes(2);
    });

    it("should handle null hash response", async () => {
      mockGetDirectoryHash.mockResolvedValue(undefined);

      const result = await repository.getDirectoryHash("docs");
      expect(result).toBeNull();
    });

    it("should handle errors and return null", async () => {
      mockGetDirectoryHash.mockRejectedValue(new Error("API error"));

      const result = await repository.getDirectoryHash("docs");
      expect(result).toBeNull();
      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe("listFiles", () => {
    it("should list files with relative paths", async () => {
      mockGetGithubDirectoryContents.mockResolvedValue([
        { type: "file", path: "/custom/path/docs/file1.json", name: "file1.json", sha: "abc123", size: 100 },
        { type: "file", path: "/custom/path/docs/subdir/file2.json", name: "file2.json", sha: "def456", size: 200 },
        { type: "dir", path: "/custom/path/docs/subdir", name: "subdir", sha: "ghi789", size: 0 },
      ]);

      const result = await repository.listFiles("docs");

      expect(result).toEqual(["docs/file1.json", "docs/subdir/file2.json"]);
    });

    it("should handle non-recursive listing", async () => {
      mockGetGithubDirectoryContents.mockResolvedValue([
        { type: "file", path: "/custom/path/docs/file1.json", name: "file1.json", sha: "abc123", size: 100 },
        { type: "file", path: "/custom/path/docs/file2.json", name: "file2.json", sha: "def456", size: 200 },
      ]);

      const result = await repository.listFiles("docs", false);

      expect(mockGetGithubDirectoryContents).toHaveBeenCalledWith(
        expect.anything(),
        "/custom/path/docs",
        "test-token",
        false,
      );
      expect(result).toEqual(["docs/file1.json", "docs/file2.json"]);
    });

    it("should handle root path correctly", async () => {
      const repoWithRoot = new GithubDocumentRepository({
        ...defaultGithubOpts,
        customDirectory: "/",
      });

      mockGetGithubDirectoryContents.mockResolvedValue([
        { type: "file", path: "docs/file1.json", name: "file1.json", sha: "abc123", size: 100 },
        { type: "file", path: "docs/file2.json", name: "file2.json", sha: "def456", size: 200 },
      ]);

      const result = await repoWithRoot.listFiles("docs");

      expect(result).toEqual(["docs/file1.json", "docs/file2.json"]);
    });

    it("should handle errors and return empty array", async () => {
      mockGetGithubDirectoryContents.mockRejectedValue(new Error("API error"));

      const result = await repository.listFiles("docs");

      expect(result).toEqual([]);
      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe("getFileContent", () => {
    it("should fetch file content", async () => {
      const content = "file content here";
      mockFetchGitHubFile.mockClear();
      mockFetchGitHubFile.mockResolvedValue(content);

      const result = await repository.getFileContent("docs/file.txt");

      expect(result).toBe(content);
      expect(mockFetchGitHubFile).toHaveBeenCalledWith(expect.anything(), "/custom/path/docs/file.txt", "test-token");
    });

    it("should handle binary content", async () => {
      const binaryContent = Buffer.from("binary data");
      mockFetchGitHubFile.mockResolvedValue(binaryContent as unknown as string);

      const result = await repository.getFileContent("docs/image.png");

      expect(result).toBe(binaryContent);
    });

    it("should handle errors and return null", async () => {
      mockFetchGitHubFile.mockRejectedValue(new Error("Network error"));

      const result = await repository.getFileContent("docs/file.txt");

      expect(result).toBeNull();
      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe("constructor and path handling", () => {
    it("should use default root path when customDirectory is not provided", () => {
      const repoWithDefaults = new GithubDocumentRepository({
        ...defaultGithubOpts,
        customDirectory: undefined,
      });

      // Test through a method call that uses the path
      mockFetchGitHubFile.mockResolvedValue("content");
      repoWithDefaults.getFileContent("test.txt");

      expect(mockFetchGitHubFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("test.txt"),
        expect.anything(),
      );
    });

    it("should normalize paths with trailing slashes", () => {
      const repoWithTrailingSlash = new GithubDocumentRepository({
        ...defaultGithubOpts,
        customDirectory: "/custom/path/",
      });

      mockFetchGitHubFile.mockResolvedValue("content");
      repoWithTrailingSlash.getFileContent("test.txt");

      expect(mockFetchGitHubFile).toHaveBeenCalledWith(expect.anything(), "/custom/path/test.txt", expect.anything());
    });

    it("should handle paths with leading slashes", async () => {
      mockFetchGitHubFile.mockResolvedValue("content");

      await repository.getFileContent("/test.txt");

      expect(mockFetchGitHubFile).toHaveBeenCalledWith(expect.anything(), "/custom/path/test.txt", expect.anything());
    });
  });
});
