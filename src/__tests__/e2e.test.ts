import { ORDConfiguration, ORDDocument } from "@open-resource-discovery/specification";
import path from "path";
import * as fs from "fs/promises";
import { OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { startProviderServer } from "src/server.js";
import { PATH_CONSTANTS } from "../constant.js";

// Mock bcrypt to avoid native module issues in tests
jest.mock("bcryptjs", () => ({
  compare: jest.fn().mockImplementation((password) => Promise.resolve(password === "secret")),
  hash: jest.fn().mockImplementation(() => Promise.resolve("$2b$10$hashedPassword")),
}));

// Mock p-limit to avoid ESM issues in tests
jest.mock("p-limit", () => ({
  default:
    () =>
    (fn: () => unknown): unknown =>
      fn(),
}));

describe("End-to-End Testing", () => {
  const TEST_PORT = 8086;
  const TEST_HOST = "127.0.0.1";
  const SERVER_URL = `http://${TEST_HOST}:${TEST_PORT}`;
  const BASIC_AUTH_PASSWORD = "$2b$10$hashedPassword";

  let shutdownServer: () => Promise<void>;

  beforeAll(async () => {
    shutdownServer = await startProviderServer({
      ordDirectory: path.join(process.cwd(), "src/__tests__/test-files"),
      ordDocumentsSubDirectory: PATH_CONSTANTS.DOCUMENTS_SUBDIRECTORY,
      sourceType: OptSourceType.Local,
      baseUrl: SERVER_URL,
      host: "0.0.0.0",
      port: TEST_PORT,
      authentication: {
        methods: [OptAuthMethod.Basic],
        basicAuthUsers: { admin: BASIC_AUTH_PASSWORD },
      },
      dataDir: "./test-data",
      updateDelay: 30000,
      statusDashboardEnabled: false,
      cors: ["*"],
    });
  });

  afterAll(async () => {
    await shutdownServer();
    // Clean up test data directory
    try {
      await fs.rm("./test-data", { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should complete full user journey", async () => {
    // 1. Discover API
    const configResponse = await fetch(`${SERVER_URL}${PATH_CONSTANTS.WELL_KNOWN_ENDPOINT}`);
    expect(configResponse.status).toBe(200);
    const config = (await configResponse.json()) as ORDConfiguration;

    // 2. Get document
    const credentials = Buffer.from("admin:secret").toString("base64");
    const documents = config.openResourceDiscoveryV1.documents;
    expect(documents).not.toHaveLength(0);

    const documentUrl = documents![0].url;
    const documentResponse = await fetch(`${SERVER_URL}${documentUrl}`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    expect(documentResponse.status).toBe(200);
    const document = (await documentResponse.json()) as ORDDocument;
    expect(document.apiResources).not.toHaveLength(0);

    // 3. Access API resource
    const apiResource = document.apiResources![0];
    const resourceUrl = apiResource.resourceDefinitions![0].url;
    const resourceResponse = await fetch(`${SERVER_URL}${resourceUrl}`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    // CORS enabled, any origin allowed
    expect(resourceResponse.headers.get("access-control-allow-origin")).toBe("*");
    expect(resourceResponse.status).toBe(200);
  });
});
