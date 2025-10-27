import { buildGithubConfig } from "../github.js";

describe("Github Model", () => {
  describe("buildGithubConfig", () => {
    it("should build config with all required fields", () => {
      const opts = {
        apiUrl: "https://api.github.com",
        repository: "owner/repo",
        branch: "main",
        token: "test-token",
        rootDirectory: "docs",
      };

      const result = buildGithubConfig(opts);

      expect(result).toEqual({
        apiUrl: "https://api.github.com",
        owner: "owner",
        repo: "repo",
        branch: "main",
        token: "test-token",
        rootDirectory: "docs",
      });
    });

    it("should build config without optional token", () => {
      const opts = {
        apiUrl: "https://api.github.com",
        repository: "owner/repo",
        branch: "main",
      };

      const result = buildGithubConfig(opts);

      expect(result).toEqual({
        apiUrl: "https://api.github.com",
        owner: "owner",
        repo: "repo",
        branch: "main",
        token: undefined,
        rootDirectory: ".",
      });
    });

    it("should use default rootDirectory when not provided", () => {
      const opts = {
        apiUrl: "https://api.github.com",
        repository: "owner/repo",
        branch: "main",
        token: "test-token",
      };

      const result = buildGithubConfig(opts);

      expect(result.rootDirectory).toBe(".");
    });

    it("should handle enterprise GitHub API URL", () => {
      const opts = {
        apiUrl: "https://github.enterprise.com/api/v3",
        repository: "company/project",
        branch: "develop",
        token: "enterprise-token",
        rootDirectory: "api-docs",
      };

      const result = buildGithubConfig(opts);

      expect(result).toEqual({
        apiUrl: "https://github.enterprise.com/api/v3",
        owner: "company",
        repo: "project",
        branch: "develop",
        token: "enterprise-token",
        rootDirectory: "api-docs",
      });
    });

    it("should split repository correctly", () => {
      const opts = {
        apiUrl: "https://api.github.com",
        repository: "organization/repository-name",
        branch: "feature-branch",
      };

      const result = buildGithubConfig(opts);

      expect(result.owner).toBe("organization");
      expect(result.repo).toBe("repository-name");
    });

    it("should handle repository with organization and repo containing slashes in name", () => {
      const opts = {
        apiUrl: "https://api.github.com",
        repository: "org/repo",
        branch: "main",
      };

      const result = buildGithubConfig(opts);

      expect(result.owner).toBe("org");
      expect(result.repo).toBe("repo");
    });

    it("should handle different branch names", () => {
      const opts = {
        apiUrl: "https://api.github.com",
        repository: "owner/repo",
        branch: "feature/new-feature",
      };

      const result = buildGithubConfig(opts);

      expect(result.branch).toBe("feature/new-feature");
    });

    it("should handle empty rootDirectory by using default", () => {
      const opts = {
        apiUrl: "https://api.github.com",
        repository: "owner/repo",
        branch: "main",
        rootDirectory: "",
      };

      const result = buildGithubConfig(opts);

      expect(result.rootDirectory).toBe(".");
    });

    it("should preserve nested rootDirectory paths", () => {
      const opts = {
        apiUrl: "https://api.github.com",
        repository: "owner/repo",
        branch: "main",
        rootDirectory: "docs/api/v1",
      };

      const result = buildGithubConfig(opts);

      expect(result.rootDirectory).toBe("docs/api/v1");
    });
  });
});
