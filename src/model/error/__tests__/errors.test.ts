/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { InternalServerError } from "src/model/error/InternalServerError.js";
import { NotFoundError } from "src/model/error/NotFoundError.js";
import { UnauthorizedError } from "src/model/error/UnauthorizedError.js";
import {
  GitHubAccessError,
  GitHubFileNotFoundError,
  GitHubNetworkError,
  GitHubDirectoryNotFoundError,
  GitHubDirectoryInvalidError,
  GitHubRepositoryNotFoundError,
  GitHubBranchNotFoundError,
} from "src/model/error/GithubErrors.js";
import { DiskSpaceError, MemoryError, TimeoutError } from "src/model/error/SystemErrors.js";

describe("Error Classes", () => {
  describe("BackendError", () => {
    it("should create error with basic properties", () => {
      const error = new InternalServerError("Test error");
      expect(error.message).toBe("Test error");
      expect(error.getHttpStatusCode()).toBe(500);
    });

    it("should create error with details", () => {
      const error = new InternalServerError("Test error", "test-target", [
        { code: "DETAIL", message: "Detail message" },
      ]);
      const response = error.getErrorResponse();
      expect(response.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(response.error.target).toBe("test-target");
      expect(response.error.message).toBe("Test error");
      expect(response.error.details).toHaveLength(1);
    });
  });

  describe("Specific Error Classes", () => {
    it("should create NotFoundError with correct status", () => {
      const error = new NotFoundError("Resource not found");
      expect(error.getHttpStatusCode()).toBe(404);
    });

    it("should create UnauthorizedError with correct status", () => {
      const error = new UnauthorizedError("Unauthorized access");
      expect(error.getHttpStatusCode()).toBe(401);
    });

    it("should create InternalServerError with correct status", () => {
      const error = new InternalServerError("Server error");
      expect(error.getHttpStatusCode()).toBe(500);
    });
  });

  describe("GitHubErrors", () => {
    describe("GitHubAccessError", () => {
      it("should create from HTTP error with status code", () => {
        const mockResponse = {
          status: 403,
          statusText: "Forbidden",
        } as Response;

        const error = GitHubAccessError.fromHttpError(mockResponse, "/test/path");

        expect(error.getHttpStatusCode()).toBe(403);
        expect(error.message).toContain("GitHub access failed");
        expect(error.message).toContain("403");
        expect(error.errorItem.target).toBe("/test/path");
        expect(error.errorItem.details).toHaveLength(1);
        expect(error.errorItem.details?.[0].code).toBe("HTTP_403");
      });

      it("should create from HTTP error without target", () => {
        const mockResponse = {
          status: 401,
          statusText: "Unauthorized",
        } as Response;

        const error = GitHubAccessError.fromHttpError(mockResponse);

        expect(error.getHttpStatusCode()).toBe(401);
        expect(error.errorItem.target).toBeUndefined();
      });
    });

    describe("GitHubFileNotFoundError", () => {
      it("should create error for path without original error", () => {
        const error = GitHubFileNotFoundError.forPath("/test/file.json");

        expect(error.getHttpStatusCode()).toBe(404);
        expect(error.message).toContain("/test/file.json");
        expect(error.errorItem.target).toBe("/test/file.json");
        expect(error.errorItem.details).toEqual([]);
      });

      it("should create error for path with original error", () => {
        const originalError = new Error("Network failure");
        const error = GitHubFileNotFoundError.forPath("/test/file.json", originalError);

        expect(error.errorItem.details).toHaveLength(1);
        expect(error.errorItem.details?.[0].code).toBe("ORIGINAL_ERROR");
        expect(error.errorItem.details?.[0].message).toBe("Network failure");
      });
    });

    describe("GitHubNetworkError", () => {
      it("should create from generic error", () => {
        const originalError = new Error("Connection timeout");
        const error = GitHubNetworkError.fromError(originalError, "https://github.com");

        expect(error.getHttpStatusCode()).toBe(503);
        expect(error.message).toBe("Failed to connect to GitHub");
        expect(error.errorItem.target).toBe("https://github.com");
        expect(error.errorItem.details).toHaveLength(1);
        expect(error.errorItem.details?.[0].code).toBe("CONNECTION_ERROR");
      });

      it("should create from Failed to fetch TypeError", () => {
        const originalError = new TypeError("Failed to fetch");
        const error = GitHubNetworkError.fromError(originalError, "https://github.com");

        expect(error.message).toBe("Unable to reach GitHub server");
        expect(error.errorItem.details?.[0].code).toBe("NETWORK_UNREACHABLE");
      });
    });

    describe("GitHubDirectoryNotFoundError", () => {
      it("should create error for path", () => {
        const error = GitHubDirectoryNotFoundError.forPath("/test/directory");

        expect(error.getHttpStatusCode()).toBe(404);
        expect(error.message).toContain("/test/directory");
        expect(error.errorItem.target).toBe("/test/directory");
      });

      it("should include original error details", () => {
        const originalError = new Error("Directory does not exist");
        const error = GitHubDirectoryNotFoundError.forPath("/test/dir", originalError);

        expect(error.errorItem.details).toHaveLength(1);
        expect(error.errorItem.details?.[0].message).toBe("Directory does not exist");
      });
    });

    describe("GitHubDirectoryInvalidError", () => {
      it("should create error for invalid directory", () => {
        const error = GitHubDirectoryInvalidError.forPath("/test/empty-dir");

        expect(error.getHttpStatusCode()).toBe(400);
        expect(error.message).toContain("No valid document found");
        expect(error.message).toContain("/test/empty-dir");
        expect(error.errorItem.target).toBe("/test/empty-dir");
      });

      it("should include original error when provided", () => {
        const originalError = new Error("No JSON files found");
        const error = GitHubDirectoryInvalidError.forPath("/test/dir", originalError);

        expect(error.errorItem.details).toHaveLength(1);
        expect(error.errorItem.details?.[0].code).toBe("ORIGINAL_ERROR");
        expect(error.errorItem.details?.[0].message).toBe("No JSON files found");
      });
    });

    describe("GitHubRepositoryNotFoundError", () => {
      it("should create error for repository without original error", () => {
        const error = GitHubRepositoryNotFoundError.forRepository("owner", "repo");

        expect(error.getHttpStatusCode()).toBe(404);
        expect(error.message).toContain("owner/repo");
        expect(error.errorItem.target).toBe("owner/repo");
        expect(error.errorItem.details).toHaveLength(1);
        expect(error.errorItem.details?.[0].code).toBe("REPOSITORY_NOT_FOUND");
        expect(error.errorItem.details?.[0].message).toContain("owner/repo");
      });

      it("should include original error details", () => {
        const originalError = new Error("404 Not Found");
        const error = GitHubRepositoryNotFoundError.forRepository("owner", "repo", originalError);

        expect(error.errorItem.details).toHaveLength(2);
        expect(error.errorItem.details?.[1].code).toBe("ORIGINAL_ERROR");
        expect(error.errorItem.details?.[1].message).toBe("404 Not Found");
      });
    });

    describe("GitHubBranchNotFoundError", () => {
      it("should create error for branch without original error", () => {
        const error = GitHubBranchNotFoundError.forBranch("feature-branch", "owner/repo");

        expect(error.getHttpStatusCode()).toBe(404);
        expect(error.message).toContain("feature-branch");
        expect(error.errorItem.target).toBe("owner/repo#feature-branch");
        expect(error.errorItem.details).toHaveLength(1);
        expect(error.errorItem.details?.[0].code).toBe("BRANCH_NOT_FOUND");
      });

      it("should include original error details", () => {
        const originalError = new Error("Branch does not exist");
        const error = GitHubBranchNotFoundError.forBranch("main", "owner/repo", originalError);

        expect(error.errorItem.details).toHaveLength(2);
        expect(error.errorItem.details?.[1].code).toBe("ORIGINAL_ERROR");
        expect(error.errorItem.details?.[1].message).toBe("Branch does not exist");
      });
    });
  });

  describe("SystemErrors", () => {
    describe("DiskSpaceError", () => {
      it("should create from error", () => {
        const originalError = new Error("ENOSPC: no space left on device");
        const error = DiskSpaceError.fromError(originalError, "/data/tmp");

        expect(error.getHttpStatusCode()).toBe(507);
        expect(error.message).toBe("No disk space available");
        expect(error.errorItem.target).toBe("/data/tmp");
        expect(error.errorItem.details).toHaveLength(1);
        expect(error.errorItem.details?.[0].code).toBe("ENOSPC");
        expect(error.errorItem.details?.[0].message).toContain("ENOSPC");
      });

      it("should handle error without message", () => {
        const originalError = new Error();
        const error = DiskSpaceError.fromError(originalError);

        expect(error.errorItem.details?.[0].message).toBe("No space left on device");
      });
    });

    describe("MemoryError", () => {
      it("should create from error", () => {
        const originalError = new Error("ENOMEM: out of memory");
        const error = MemoryError.fromError(originalError, "operation");

        expect(error.getHttpStatusCode()).toBe(507);
        expect(error.message).toBe("Insufficient memory available");
        expect(error.errorItem.target).toBe("operation");
        expect(error.errorItem.details).toHaveLength(1);
        expect(error.errorItem.details?.[0].code).toBe("ENOMEM");
      });

      it("should handle error without message", () => {
        const originalError = new Error();
        const error = MemoryError.fromError(originalError);

        expect(error.errorItem.details?.[0].message).toBe("Out of memory");
      });
    });

    describe("TimeoutError", () => {
      it("should create from wait error", () => {
        const originalError = new Error("Operation timed out after 30s");
        const error = TimeoutError.fromWaitError(originalError, "git clone");

        expect(error.getHttpStatusCode()).toBe(503);
        expect(error.message).toContain("timed out while waiting");
        expect(error.errorItem.target).toBe("git clone");
        expect(error.errorItem.details).toHaveLength(1);
        expect(error.errorItem.details?.[0].code).toBe("WAIT_TIMEOUT");
        expect(error.errorItem.details?.[0].message).toBe("Operation timed out after 30s");
      });

      it("should handle error without message", () => {
        const originalError = new Error();
        const error = TimeoutError.fromWaitError(originalError, "fetch");

        expect(error.errorItem.details?.[0].message).toBe("Timeout during fetch");
      });
    });
  });
});
