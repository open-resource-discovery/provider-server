import { ordConfigurationSchema } from "@open-resource-discovery/specification";
import fs from "fs";
import { OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { validateAndParseOptions as originalValidateAndParseOptions } from "src/util/optsValidation.js";

// We need to mock bcrypt since it's used by passwordHash which is imported by optsValidation
jest.mock("bcryptjs", () => ({
  compare: jest.fn().mockImplementation(() => Promise.resolve(true)),
  hash: jest.fn().mockImplementation(() => Promise.resolve("hashedPassword")),
}));

// @ts-expect-error baseUrl pattern selection
const ordBaseUrlPattern = new RegExp(ordConfigurationSchema.properties["baseUrl"]["pattern"]);

jest.mock("fs", () => ({
  statSync: jest.fn(),
  readdirSync: jest.fn(),
  existsSync: jest.fn(),
  // needed for @open-resource-discovery/specification
  readFileSync: jest.fn().mockReturnValue(
    JSON.stringify({
      properties: {
        baseUrl: {
          pattern: ".*",
        },
      },
      definitions: {
        ApiResource: {
          properties: {
            ordId: {
              pattern: ".*",
            },
          },
        },
        EventResource: {
          properties: {
            ordId: {
              pattern: ".*",
            },
          },
        },
      },
    }),
  ),
}));

jest.spyOn(global, "RegExp").mockImplementation(() => ordBaseUrlPattern);

const mockStatSyncImplementation = (...args: unknown[]): { isDirectory?: () => boolean; isFile?: () => boolean } => {
  const filePath = args[0] as string;
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (normalizedPath.endsWith("test-dir")) {
    return { isDirectory: (): boolean => true };
  }
  if (normalizedPath.endsWith("test-dir/documents")) {
    return { isDirectory: (): boolean => true };
  }
  if (normalizedPath.endsWith("test-dir/documents/file1.json")) {
    return { isFile: (): boolean => true };
  }

  throw new Error(`fs.statSync called with unexpected path: ${filePath}`);
};

describe("Options Validation", () => {
  let validateAndParseOptions: typeof originalValidateAndParseOptions;

  beforeAll(async () => {
    const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = mockFetch;

    const { validateAndParseOptions: mockedValidateAndParseOptions } = await import("src/util/optsValidation.js");
    validateAndParseOptions = mockedValidateAndParseOptions;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.statSync as jest.Mock).mockReset();
    (fs.readdirSync as jest.Mock).mockReset();
  });

  const baseUrl = "http://127.0.0.1:8080";
  describe("SourceType", () => {
    it("should validate local source type with required directory", async () => {
      (fs.statSync as jest.Mock).mockImplementation(mockStatSyncImplementation);
      (fs.readdirSync as jest.Mock).mockReturnValue(["file1.json"]);
      (fs.readFileSync as jest.Mock).mockReturnValue('{"openResourceDiscovery": {}}');

      const options = {
        sourceType: OptSourceType.Local,
        directory: "./test-dir",
        auth: [OptAuthMethod.Open],
        baseUrl,
        documentsSubdirectory: "documents",
      };
      await expect(validateAndParseOptions(options)).resolves.toBeDefined();
    });

    it("should throw an error for a json file without openResourceDiscoveryProperty", async () => {
      (fs.statSync as jest.Mock).mockImplementation(mockStatSyncImplementation);
      (fs.readdirSync as jest.Mock).mockReturnValue(["file1.json"]);

      const options = {
        sourceType: OptSourceType.Local,
        directory: "./test-dir",
        auth: [OptAuthMethod.Open],
        baseUrl,
        documentsSubdirectory: "documents",
      };

      (fs.readFileSync as jest.Mock)
        .mockReset()
        .mockImplementationOnce(() => JSON.stringify({ openResourceDiscovery: {} }));

      await expect(validateAndParseOptions(options)).resolves.toBeDefined();

      (fs.readFileSync as jest.Mock).mockReset().mockImplementationOnce(() => JSON.stringify({ foo: {} }));

      await expect(validateAndParseOptions(options)).rejects.toThrow();
    });

    it("should throw error for local source type without directory", async () => {
      const options = {
        sourceType: OptSourceType.Local,
        auth: [OptAuthMethod.Open],
        documentsSubdirectory: "documents",
      };
      await expect(validateAndParseOptions(options)).rejects.toThrow();
    });

    it("should validate github source type with all required parameters", async () => {
      const mockResponseDirectory: Partial<Response> = {
        ok: true,
        status: 200,
        statusText: "OK",
        json: jest.fn().mockResolvedValue([
          {
            name: "test.json",
            path: "documents/test.json",
            type: "file",
          },
        ]),
      };

      const mockResponseFileMetadata: Partial<Response> = {
        ok: true,
        status: 200,
        statusText: "OK",
        json: jest.fn().mockResolvedValue({
          name: "test.json",
          path: "documents/test.json",
          type: "file",
          sha: "dummySha123",
          size: 123,
          content: Buffer.from(JSON.stringify({ openResourceDiscovery: {} })).toString("base64"),
          encoding: "base64",
        }),
      };

      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch
        .mockResolvedValueOnce(mockResponseDirectory as Response)
        .mockResolvedValueOnce(mockResponseFileMetadata as Response);

      const options = {
        sourceType: OptSourceType.Github,
        auth: [OptAuthMethod.Open],
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
        githubToken: "token",
        baseUrl,
        documentsSubdirectory: "documents",
      };

      await expect(validateAndParseOptions(options)).resolves.toBeDefined();

      // Verify that fetch was called with the correct path
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/documents"),
        expect.objectContaining({
          headers: { Authorization: "Token token" },
        }),
      );
    });

    it("should throw error without github token", async () => {
      const options = {
        sourceType: OptSourceType.Github,
        auth: [OptAuthMethod.Open],
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
        documentsSubdirectory: "documents",
      };
      await expect(validateAndParseOptions(options)).rejects.toThrow();
    });

    it("should throw error when github directory is not found", async () => {
      const mockResponse: Partial<Response> = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: jest.fn().mockResolvedValue({ message: "Not Found" }),
      };

      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue(mockResponse as Response);

      const options = {
        sourceType: OptSourceType.Github,
        auth: [OptAuthMethod.Open],
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
        githubToken: "token",
        documentsSubdirectory: "documents",
      };

      await expect(validateAndParseOptions(options)).rejects.toThrow();
    });
  });

  describe("Authentication", () => {
    beforeEach(() => {
      (fs.statSync as jest.Mock).mockImplementation(() => ({ isDirectory: (): boolean => true }));
      (fs.readdirSync as jest.Mock).mockReturnValue(["file1.txt"]);
    });

    it("should throw error for mixed auth with open strategy", async () => {
      const options = {
        sourceType: OptSourceType.Local,
        directory: "./test-dir",
        auth: [OptAuthMethod.Open, OptAuthMethod.Basic],
        documentsSubdirectory: "documents",
      };
      await expect(validateAndParseOptions(options)).rejects.toThrow();
    });

    it("should throw error for basic auth without BASIC_AUTH env", async () => {
      const options = {
        sourceType: OptSourceType.Local,
        directory: "./test-dir",
        auth: [OptAuthMethod.Basic],
        documentsSubdirectory: "documents",
      };
      await expect(validateAndParseOptions(options)).rejects.toThrow();
    });
  });

  describe("baseUrl check", () => {
    it("should throw error for invalid baseUrl", async () => {
      const options = {
        sourceType: OptSourceType.Local,
        directory: "./test-dir",
        auth: [OptAuthMethod.Open],
        documentsSubdirectory: "documents",
        baseUrl: "test:8080",
      };
      await expect(validateAndParseOptions(options)).rejects.toThrow();

      const options2 = {
        ...options,
        baseUrl: "http://localhost",
        documentsSubdirectory: "documents",
      };
      await expect(validateAndParseOptions(options2)).rejects.toThrow();
    });

    it("should pass with valid baseUrl", async (): Promise<void> => {
      const mockValidFileSystem = (): void => {
        (fs.statSync as jest.Mock).mockImplementation(mockStatSyncImplementation);
        (fs.readdirSync as jest.Mock).mockReturnValue(["file1.json"]);
        (fs.readFileSync as jest.Mock)
          .mockReset()
          .mockImplementation(() => JSON.stringify({ openResourceDiscovery: {} }));
      };

      const baseOptions = {
        sourceType: OptSourceType.Local,
        directory: "./test-dir",
        auth: [OptAuthMethod.Open],
        documentsSubdirectory: "documents",
      };

      const validBaseUrls = ["http://127.0.0.1:8080", "https://example.com/ord/v1"];

      for (const baseUrl of validBaseUrls) {
        mockValidFileSystem();

        const options = {
          ...baseOptions,
          baseUrl,
        };

        await expect(validateAndParseOptions(options)).resolves.toBeDefined();
      }
    });
  });
});
