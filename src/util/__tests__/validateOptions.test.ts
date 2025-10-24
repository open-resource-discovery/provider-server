/* eslint-disable @typescript-eslint/no-explicit-any */
import { validateOffline, validateLocalDirectory } from "../validateOptions.js";
import { CommandLineOptions, OptAuthMethod, OptSourceType } from "../../model/cli.js";
import { ValidationError } from "../../model/error/ValidationError.js";
import { LocalDirectoryError } from "../../model/error/OrdDirectoryError.js";
import * as fs from "fs";

jest.mock("fs");
jest.mock("../logger.js", () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("validateOptions", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.BASIC_AUTH;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("validateOffline", () => {
    it("should validate local source type successfully", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      const mockReaddirSync = jest.spyOn(fs, "readdirSync");
      const mockReadFileSync = jest.spyOn(fs, "readFileSync");

      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => true } as any);

      mockReaddirSync.mockReturnValue(["doc1.json"] as any);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          openResourceDiscovery: "1.9",
          $schema: "test",
        }),
      );

      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/test/directory",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
      };

      const result = validateOffline(options);

      expect(result.needsOnlineValidation).toBe(false);
      expect(result.options.sourceType).toBe(OptSourceType.Local);

      mockStatSync.mockRestore();
      mockReaddirSync.mockRestore();
      mockReadFileSync.mockRestore();
    });

    it("should validate GitHub source type successfully", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Github,
        directory: "docs",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
        githubToken: "test-token",
      };

      const result = validateOffline(options);

      expect(result.needsOnlineValidation).toBe(true);
      expect(result.options.sourceType).toBe(OptSourceType.Github);
    });

    it("should throw ValidationError for missing baseUrl", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/test",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
      } as any;

      expect(() => validateOffline(options)).toThrow(ValidationError);
    });

    it("should throw ValidationError for invalid baseUrl", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/test",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "invalid-url",
      };

      expect(() => validateOffline(options)).toThrow(ValidationError);
    });

    it("should throw ValidationError when mixing open auth with other methods", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/test",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open, OptAuthMethod.Basic],
        baseUrl: "https://example.com",
      };

      expect(() => validateOffline(options)).toThrow(ValidationError);
      expect(() => validateOffline(options)).toThrow(
        'Authentication method "open" cannot be used together with other options.',
      );
    });

    it("should throw ValidationError when no valid auth method specified", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/test",
        documentsSubdirectory: "documents",
        auth: [],
        baseUrl: "https://example.com",
      };

      expect(() => validateOffline(options)).toThrow(ValidationError);
      expect(() => validateOffline(options)).toThrow("No valid authentication method specified.");
    });

    it("should validate basic auth with valid BASIC_AUTH env var", () => {
      process.env.BASIC_AUTH = '{"user1":"$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"}';

      const mockStatSync = jest.spyOn(fs, "statSync");
      const mockReaddirSync = jest.spyOn(fs, "readdirSync");
      const mockReadFileSync = jest.spyOn(fs, "readFileSync");

      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => true } as any);

      mockReaddirSync.mockReturnValue(["doc1.json"] as any);
      mockReadFileSync.mockReturnValue(JSON.stringify({ openResourceDiscovery: "1.9", $schema: "test" }));

      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/test",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Basic],
        baseUrl: "https://example.com",
      };

      const result = validateOffline(options);
      expect(result.options.authentication.methods).toContain(OptAuthMethod.Basic);

      mockStatSync.mockRestore();
      mockReaddirSync.mockRestore();
      mockReadFileSync.mockRestore();
    });

    it("should throw ValidationError for invalid basic auth format", () => {
      process.env.BASIC_AUTH = '{"user1":"not-a-bcrypt-hash"}';

      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/test",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Basic],
        baseUrl: "https://example.com",
      };

      expect(() => validateOffline(options)).toThrow(ValidationError);
    });

    it("should throw ValidationError for empty BASIC_AUTH object", () => {
      process.env.BASIC_AUTH = "{}";

      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/test",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Basic],
        baseUrl: "https://example.com",
      };

      expect(() => validateOffline(options)).toThrow(ValidationError);
      expect(() => validateOffline(options)).toThrow(
        'Environment variable "BASIC_AUTH" cannot be empty when basic auth is enabled.',
      );
    });

    it("should throw ValidationError for invalid JSON in BASIC_AUTH", () => {
      process.env.BASIC_AUTH = "invalid-json{";

      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/test",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Basic],
        baseUrl: "https://example.com",
      };

      expect(() => validateOffline(options)).toThrow(ValidationError);
    });

    it("should throw ValidationError for missing directory in local mode", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
      };

      expect(() => validateOffline(options)).toThrow(ValidationError);
      expect(() => validateOffline(options)).toThrow('--directory (-d) is required when --source-type is "local"');
    });

    it("should throw ValidationError for missing GitHub parameters", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Github,
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
      };

      expect(() => validateOffline(options)).toThrow(ValidationError);
    });

    it("should throw ValidationError for invalid source type", () => {
      const options: CommandLineOptions = {
        sourceType: "invalid" as any,
        directory: "/test",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
      };

      expect(() => validateOffline(options)).toThrow(ValidationError);
      expect(() => validateOffline(options)).toThrow(/Invalid source type/);
    });

    it("should throw ValidationError when BASIC_AUTH is not an object", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      const mockReaddirSync = jest.spyOn(fs, "readdirSync");
      const mockReadFileSync = jest.spyOn(fs, "readFileSync");

      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => true } as any);
      mockReaddirSync.mockReturnValue(["doc1.json"] as any);
      mockReadFileSync.mockReturnValue(JSON.stringify({ openResourceDiscovery: "1.9", $schema: "test" }));

      process.env.BASIC_AUTH = "not-an-object-string";

      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/test",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Basic],
        baseUrl: "https://example.com",
      };

      expect(() => validateOffline(options)).toThrow(ValidationError);
      expect(() => validateOffline(options)).toThrow(/Invalid JSON/);

      mockStatSync.mockRestore();
      mockReaddirSync.mockRestore();
      mockReadFileSync.mockRestore();
    });

    it("should throw ValidationError when BASIC_AUTH is an array", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      const mockReaddirSync = jest.spyOn(fs, "readdirSync");
      const mockReadFileSync = jest.spyOn(fs, "readFileSync");

      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => true } as any);
      mockReaddirSync.mockReturnValue(["doc1.json"] as any);
      mockReadFileSync.mockReturnValue(JSON.stringify({ openResourceDiscovery: "1.9", $schema: "test" }));

      process.env.BASIC_AUTH = '["user1", "user2"]';

      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/test",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Basic],
        baseUrl: "https://example.com",
      };

      expect(() => validateOffline(options)).toThrow(ValidationError);
      expect(() => validateOffline(options)).toThrow(/must be a JSON object/);

      mockStatSync.mockRestore();
      mockReaddirSync.mockRestore();
      mockReadFileSync.mockRestore();
    });
  });

  describe("validateLocalDirectory", () => {
    it("should validate directory with valid ORD documents", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      const mockReaddirSync = jest.spyOn(fs, "readdirSync");
      const mockReadFileSync = jest.spyOn(fs, "readFileSync");

      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => true } as any);
      mockReaddirSync.mockReturnValue(["doc1.json", "doc2.json"] as any);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          openResourceDiscovery: "1.9",
          $schema: "https://github.com/open-resource-discovery/spec-v1/interfaces/Document.schema.json",
        }),
      );

      expect(() => validateLocalDirectory("/test/directory")).not.toThrow();

      mockStatSync.mockRestore();
      mockReaddirSync.mockRestore();
      mockReadFileSync.mockRestore();
    });

    it("should throw LocalDirectoryError when directory does not exist", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      mockStatSync.mockImplementation(() => {
        const error: any = new Error("ENOENT");
        error.code = "ENOENT";
        throw error;
      });

      expect(() => validateLocalDirectory("/nonexistent")).toThrow(LocalDirectoryError);
      expect(() => validateLocalDirectory("/nonexistent")).toThrow("Directory not found");

      mockStatSync.mockRestore();
    });

    it("should throw LocalDirectoryError when path is not a directory", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");

      mockStatSync.mockReturnValue({ isDirectory: () => false } as any);

      expect(() => validateLocalDirectory("/file.txt")).toThrow(LocalDirectoryError);
      expect(() => validateLocalDirectory("/file.txt")).toThrow("Specified path is not a directory");

      mockStatSync.mockRestore();
    });

    it("should throw LocalDirectoryError when documents subdirectory not found", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      mockStatSync.mockImplementation((path) => {
        if (path.toString().includes("documents")) {
          const error: any = new Error("ENOENT");
          error.code = "ENOENT";
          throw error;
        }
        return { isDirectory: () => true } as any;
      });

      expect(() => validateLocalDirectory("/test")).toThrow(LocalDirectoryError);
      expect(() => validateLocalDirectory("/test")).toThrow("'documents' folder not found in directory");

      mockStatSync.mockRestore();
    });

    it("should throw LocalDirectoryError when documents folder is not a directory", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      mockStatSync.mockImplementation((path) => {
        if (path.toString().includes("documents")) {
          return { isDirectory: () => false } as any;
        }
        return { isDirectory: () => true } as any;
      });

      expect(() => validateLocalDirectory("/test")).toThrow(LocalDirectoryError);
      expect(() => validateLocalDirectory("/test")).toThrow("'documents' folder is not a directory");

      mockStatSync.mockRestore();
    });

    it("should throw LocalDirectoryError when documents folder is empty", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      const mockReaddirSync = jest.spyOn(fs, "readdirSync");

      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => false } as any);
      mockReaddirSync.mockReturnValue([] as any);

      expect(() => validateLocalDirectory("/test")).toThrow(LocalDirectoryError);
      expect(() => validateLocalDirectory("/test")).toThrow("'documents' folder is empty");

      mockStatSync.mockRestore();
      mockReaddirSync.mockRestore();
    });

    it("should throw LocalDirectoryError when no valid ORD document found", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      const mockReaddirSync = jest.spyOn(fs, "readdirSync");
      const mockReadFileSync = jest.spyOn(fs, "readFileSync");

      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => true } as any);
      mockReaddirSync.mockReturnValue(["invalid.json"] as any);
      mockReadFileSync.mockReturnValue(JSON.stringify({ invalid: "document" }));

      expect(() => validateLocalDirectory("/test")).toThrow(LocalDirectoryError);
      expect(() => validateLocalDirectory("/test")).toThrow("No valid ORD document found");

      mockStatSync.mockRestore();
      mockReaddirSync.mockRestore();
      mockReadFileSync.mockRestore();
    });

    it("should use custom documents subdirectory", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      const mockReaddirSync = jest.spyOn(fs, "readdirSync");
      const mockReadFileSync = jest.spyOn(fs, "readFileSync");

      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => true } as any);
      mockReaddirSync.mockReturnValue(["doc.json"] as any);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          openResourceDiscovery: "1.9",
          $schema: "test",
        }),
      );

      expect(() => validateLocalDirectory("/test", "custom-docs")).not.toThrow();

      mockStatSync.mockRestore();
      mockReaddirSync.mockRestore();
      mockReadFileSync.mockRestore();
    });

    it("should skip non-JSON files", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      const mockReaddirSync = jest.spyOn(fs, "readdirSync");
      const mockReadFileSync = jest.spyOn(fs, "readFileSync");

      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => true } as any);
      mockReaddirSync.mockReturnValue(["file.txt", "doc.json"] as any);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          openResourceDiscovery: "1.9",
          $schema: "test",
        }),
      );

      expect(() => validateLocalDirectory("/test")).not.toThrow();

      mockStatSync.mockRestore();
      mockReaddirSync.mockRestore();
      mockReadFileSync.mockRestore();
    });

    it("should handle unexpected errors", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      mockStatSync.mockImplementation(() => {
        throw new Error("Unexpected file system error");
      });

      expect(() => validateLocalDirectory("/test")).toThrow(LocalDirectoryError);
      expect(() => validateLocalDirectory("/test")).toThrow("Unexpected error during validation");

      mockStatSync.mockRestore();
    });

    it("should skip files that cannot be read", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      const mockReaddirSync = jest.spyOn(fs, "readdirSync");
      const mockReadFileSync = jest.spyOn(fs, "readFileSync");

      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => true } as any);
      mockReaddirSync.mockReturnValue(["bad.json", "good.json"] as any);
      mockReadFileSync
        .mockImplementationOnce(() => {
          throw new Error("Cannot read");
        })
        .mockImplementationOnce(() =>
          JSON.stringify({
            openResourceDiscovery: "1.9",
            $schema: "test",
          }),
        );

      expect(() => validateLocalDirectory("/test")).not.toThrow();

      mockStatSync.mockRestore();
      mockReaddirSync.mockRestore();
      mockReadFileSync.mockRestore();
    });

    it("should skip files when statSync throws an error", () => {
      const mockStatSync = jest.spyOn(fs, "statSync");
      const mockReaddirSync = jest.spyOn(fs, "readdirSync");
      const mockReadFileSync = jest.spyOn(fs, "readFileSync");

      mockReaddirSync.mockReturnValue(["accessible.json", "inaccessible.json"] as any);

      // Use a counter to track calls and handle the error case
      let callCount = 0;
      mockStatSync.mockImplementation((path: any) => {
        callCount++;
        // First two calls are for directory checks
        if (callCount <= 2) {
          return { isDirectory: () => true } as any;
        }
        // accessible.json file check
        if (path.includes("accessible")) {
          return { isFile: () => true } as any;
        }
        // inaccessible.json - throw error (testing line 96)
        if (path.includes("inaccessible")) {
          throw new Error("Permission denied");
        }
        return { isFile: () => true } as any;
      });

      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          openResourceDiscovery: "1.9",
          $schema: "test",
        }),
      );

      // Should not throw - inaccessible file should be skipped
      expect(() => validateLocalDirectory("/test")).not.toThrow();

      mockStatSync.mockRestore();
      mockReaddirSync.mockRestore();
      mockReadFileSync.mockRestore();
    });
  });
});
