import { buildProviderServerOptions } from "../server.js";
import { OptSourceType, OptAuthMethod, CommandLineOptions } from "../cli.js";

jest.mock("../../util/logger.js", () => ({
  log: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

describe("Server Model", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ORD_DIRECTORY;
    delete process.env.BASIC_AUTH;
    delete process.env.WEBHOOK_SECRET;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("buildProviderServerOptions", () => {
    it("should build options for local source type", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/path/to/data",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        host: "localhost",
        port: "8080",
        dataDir: "./data",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.sourceType).toBe(OptSourceType.Local);
      expect(result.ordDirectory).toBe("/path/to/data");
      expect(result.ordDocumentsSubDirectory).toBe("documents");
      expect(result.baseUrl).toBe("https://example.com");
      expect(result.host).toBe("localhost");
      expect(result.port).toBe(8080);
      expect(result.authentication.methods).toEqual([OptAuthMethod.Open]);
    });

    it("should build options for GitHub source type", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Github,
        directory: "docs/api",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
        githubToken: "test-token",
        updateDelay: "60",
      };

      const result = buildProviderServerOptions(options);

      expect(result.sourceType).toBe(OptSourceType.Github);
      expect(result.ordDirectory).toBe("docs/api");
      expect(result.githubApiUrl).toBe("https://api.github.com");
      expect(result.githubRepository).toBe("owner/repo");
      expect(result.githubBranch).toBe("main");
      expect(result.githubToken).toBe("test-token");
      expect(result.updateDelay).toBe(60000); // Converted to milliseconds
    });

    it("should use ORD_DIRECTORY environment variable when directory not provided", () => {
      process.env.ORD_DIRECTORY = "/env/path";

      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
      };

      const result = buildProviderServerOptions(options);

      expect(result.ordDirectory).toBe("/env/path");
    });

    it("should default to current directory for GitHub when no directory specified", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Github,
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.ordDirectory).toBe(".");
    });

    it("should normalize GitHub directory path by removing slashes", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Github,
        directory: "/docs/api/",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.ordDirectory).toBe("docs/api");
    });

    it("should parse basic auth users from environment", () => {
      process.env.BASIC_AUTH = '{"user1":"$2b$10$hash1","user2":"$2b$10$hash2"}';

      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/data",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Basic],
        baseUrl: "https://example.com",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.authentication.methods).toEqual([OptAuthMethod.Basic]);
      expect(result.authentication.basicAuthUsers).toEqual({
        user1: "$2b$10$hash1",
        user2: "$2b$10$hash2",
      });
    });

    it("should not parse basic auth when using open auth", () => {
      process.env.BASIC_AUTH = '{"user":"hash"}';

      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/data",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.authentication.basicAuthUsers).toBeUndefined();
    });

    it("should parse CORS domains from comma-separated string", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/data",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        cors: "https://app1.com,https://app2.com,https://app3.com",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.cors).toEqual(["https://app1.com", "https://app2.com", "https://app3.com"]);
    });

    it("should handle missing CORS option", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/data",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.cors).toBeUndefined();
    });

    it("should use webhook secret from environment", () => {
      process.env.WEBHOOK_SECRET = "test-webhook-secret";

      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/data",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.webhookSecret).toBe("test-webhook-secret");
    });

    it("should default updateDelay to 30 seconds when not provided", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/data",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
      };

      const result = buildProviderServerOptions(options);

      expect(result.updateDelay).toBe(30000); // 30 seconds
    });

    it("should convert custom updateDelay to milliseconds", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/data",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        updateDelay: "120",
      };

      const result = buildProviderServerOptions(options);

      expect(result.updateDelay).toBe(120000); // 120 seconds
    });

    it("should enable status dashboard by default", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/data",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.statusDashboardEnabled).toBe(true);
    });

    it("should disable status dashboard when set to false", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/data",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        statusDashboardEnabled: "false",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.statusDashboardEnabled).toBe(false);
    });

    it("should trim trailing slashes from host and GitHub API URL", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Github,
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        host: "localhost/",
        githubApiUrl: "https://api.github.com/",
        githubRepository: "owner/repo",
        githubBranch: "main",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.host).toBe("localhost");
      expect(result.githubApiUrl).toBe("https://api.github.com");
    });

    it("should trim slashes from documentsSubdirectory", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/data",
        documentsSubdirectory: "/documents/",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.ordDocumentsSubDirectory).toBe("documents");
    });

    it("should use default data directory when not provided", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/data",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.dataDir).toBe("./data");
    });

    it("should use custom data directory when provided", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Local,
        directory: "/data",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        dataDir: "/custom/data",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.dataDir).toBe("/custom/data");
    });

    it("should handle empty directory for GitHub by using current directory", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Github,
        directory: "",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.ordDirectory).toBe(".");
    });

    it("should handle whitespace-only directory for GitHub by using current directory", () => {
      const options: CommandLineOptions = {
        sourceType: OptSourceType.Github,
        directory: "   ",
        documentsSubdirectory: "documents",
        auth: [OptAuthMethod.Open],
        baseUrl: "https://example.com",
        githubApiUrl: "https://api.github.com",
        githubRepository: "owner/repo",
        githubBranch: "main",
        updateDelay: "30",
      };

      const result = buildProviderServerOptions(options);

      expect(result.ordDirectory).toBe(".");
    });
  });
});
