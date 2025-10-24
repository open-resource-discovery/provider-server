/* eslint-disable @typescript-eslint/no-require-imports */
import { getOrdDocumentAccessStrategies, emptyOrdConfig, getBaseUrl, listGithubOrdDirectory } from "../ordConfig.js";
import { OptAuthMethod, OrdAccessStrategy } from "../../model/cli.js";

jest.mock("../github.js");

describe("ordConfig", () => {
  describe("getOrdDocumentAccessStrategies", () => {
    it("should convert single auth method to access strategy", () => {
      const result = getOrdDocumentAccessStrategies([OptAuthMethod.Open]);

      expect(result).toEqual([{ type: OrdAccessStrategy.Open }]);
    });

    it("should convert multiple auth methods to access strategies", () => {
      const result = getOrdDocumentAccessStrategies([OptAuthMethod.Open, OptAuthMethod.Basic]);

      expect(result).toEqual([{ type: OrdAccessStrategy.Open }, { type: OrdAccessStrategy.Basic }]);
    });

    it("should convert basic auth method to access strategy", () => {
      const result = getOrdDocumentAccessStrategies([OptAuthMethod.Basic]);

      expect(result).toEqual([{ type: OrdAccessStrategy.Basic }]);
    });

    it("should throw error when no auth methods provided", () => {
      expect(() => getOrdDocumentAccessStrategies([])).toThrow(
        "No authentication options passed for ORD config access strategies",
      );
    });
  });

  describe("emptyOrdConfig", () => {
    it("should create empty config without baseUrl", () => {
      const result = emptyOrdConfig();

      expect(result).toEqual({
        openResourceDiscoveryV1: {
          documents: [],
        },
      });
      expect(result.baseUrl).toBeUndefined();
    });

    it("should create empty config with baseUrl", () => {
      const result = emptyOrdConfig("https://example.com");

      expect(result).toEqual({
        baseUrl: "https://example.com",
        openResourceDiscoveryV1: {
          documents: [],
        },
      });
    });

    it("should create empty config with empty documents array", () => {
      const result = emptyOrdConfig();

      expect(result.openResourceDiscoveryV1.documents).toEqual([]);
      expect(Array.isArray(result.openResourceDiscoveryV1.documents)).toBe(true);
    });
  });

  describe("getBaseUrl", () => {
    it("should return empty string when baseUrl is undefined", () => {
      const result = getBaseUrl(undefined);

      expect(result).toBe("");
    });

    it("should return empty string when baseUrl is empty string", () => {
      const result = getBaseUrl("");

      expect(result).toBe("");
    });

    it("should normalize baseUrl without trailing slash", () => {
      const result = getBaseUrl("https://example.com/api/");

      expect(result).toBe("https://example.com/api");
    });

    it("should handle baseUrl without trailing slash", () => {
      const result = getBaseUrl("https://example.com");

      expect(result).toBe("https://example.com");
    });

    it("should normalize complex paths", () => {
      const result = getBaseUrl("https://example.com/api/v1/");

      expect(result).toBe("https://example.com/api/v1");
    });
  });

  describe("listGithubOrdDirectory", () => {
    it("should list ORD directory files from GitHub", async () => {
      const mockGithubDirectoryContents = [
        { type: "file", path: "documents/doc1.json" },
        { type: "file", path: "documents/doc2.json" },
        { type: "dir", path: "documents/subdir" },
      ];

      const { getGithubDirectoryContents } = require("../github.js");
      getGithubDirectoryContents.mockResolvedValue(mockGithubDirectoryContents);

      const githubOpts = {
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
        githubToken: "test-token",
        customDirectory: "ord",
      };

      const result = await listGithubOrdDirectory(githubOpts, "documents");

      expect(result).toEqual(["documents/doc1.json", "documents/doc2.json"]);
    });

    it("should filter out directories, only return files", async () => {
      const mockGithubDirectoryContents = [
        { type: "file", path: "documents/doc.json" },
        { type: "dir", path: "documents/folder" },
        { type: "file", path: "documents/readme.md" },
      ];

      const { getGithubDirectoryContents } = require("../github.js");
      getGithubDirectoryContents.mockResolvedValue(mockGithubDirectoryContents);

      const githubOpts = {
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
      };

      const result = await listGithubOrdDirectory(githubOpts, "documents");

      expect(result).toEqual(["documents/doc.json", "documents/readme.md"]);
    });

    it("should handle empty directory", async () => {
      const { getGithubDirectoryContents } = require("../github.js");
      getGithubDirectoryContents.mockResolvedValue([]);

      const githubOpts = {
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
      };

      const result = await listGithubOrdDirectory(githubOpts, "documents");

      expect(result).toEqual([]);
    });

    it("should use custom directory if provided", async () => {
      const { getGithubDirectoryContents } = require("../github.js");
      getGithubDirectoryContents.mockResolvedValue([{ type: "file", path: "custom/documents/doc.json" }]);

      const githubOpts = {
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
        customDirectory: "custom",
      };

      const result = await listGithubOrdDirectory(githubOpts, "documents");

      expect(getGithubDirectoryContents).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "https://api.github.com",
          repo: "owner/repo",
          branch: "main",
        }),
        expect.stringContaining("custom"),
        undefined,
      );
      expect(result).toEqual(["custom/documents/doc.json"]);
    });

    it("should pass GitHub token to API call", async () => {
      const { getGithubDirectoryContents } = require("../github.js");
      getGithubDirectoryContents.mockResolvedValue([]);

      const githubOpts = {
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
        githubToken: "secret-token",
      };

      await listGithubOrdDirectory(githubOpts, "documents");

      expect(getGithubDirectoryContents).toHaveBeenCalledWith(expect.anything(), expect.anything(), "secret-token");
    });
  });
});
