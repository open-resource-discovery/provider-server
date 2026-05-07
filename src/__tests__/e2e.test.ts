import { OrdConfiguration, OrdDocument } from "@open-resource-discovery/specification";
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
    const config = (await configResponse.json()) as OrdConfiguration;

    // 2. Get document
    const credentials = Buffer.from("admin:secret").toString("base64");
    const documents = config.openResourceDiscoveryV1.documents;
    expect(documents).not.toHaveLength(0);

    const documentUrl = documents![0].url;
    const documentResponse = await fetch(`${SERVER_URL}${documentUrl}`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    expect(documentResponse.status).toBe(200);
    const document = (await documentResponse.json()) as OrdDocument;
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

describe("End-to-End Testing with absolute URLs", () => {
  const TEST_PORT = 8087;
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
      absoluteUrls: true,
      host: "0.0.0.0",
      port: TEST_PORT,
      authentication: {
        methods: [OptAuthMethod.Basic],
        basicAuthUsers: { admin: BASIC_AUTH_PASSWORD },
      },
      dataDir: "./test-data-absolute",
      updateDelay: 30000,
      statusDashboardEnabled: false,
      cors: ["*"],
    });
  });

  afterAll(async () => {
    await shutdownServer();
    try {
      await fs.rm("./test-data-absolute", { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should emit absolute URLs in ORD configuration", async () => {
    const configResponse = await fetch(`${SERVER_URL}${PATH_CONSTANTS.WELL_KNOWN_ENDPOINT}`);
    expect(configResponse.status).toBe(200);
    const config = (await configResponse.json()) as OrdConfiguration;

    const documents = config.openResourceDiscoveryV1.documents;
    expect(documents).not.toHaveLength(0);

    // All document URLs must be absolute
    for (const doc of documents!) {
      expect(doc.url).toMatch(/^https?:\/\//);
      expect(doc.url).toContain(SERVER_URL);
    }
  });

  it("should emit absolute resource definition URLs in ORD documents", async () => {
    const configResponse = await fetch(`${SERVER_URL}${PATH_CONSTANTS.WELL_KNOWN_ENDPOINT}`);
    const config = (await configResponse.json()) as OrdConfiguration;
    const credentials = Buffer.from("admin:secret").toString("base64");

    const documentUrl = config.openResourceDiscoveryV1.documents![0].url;
    // documentUrl is absolute — fetch it directly
    const documentResponse = await fetch(documentUrl, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    expect(documentResponse.status).toBe(200);
    const document = (await documentResponse.json()) as OrdDocument;

    // API resource definition URLs must also be absolute
    const resourceDefs = document.apiResources?.[0]?.resourceDefinitions;
    if (resourceDefs && resourceDefs.length > 0) {
      expect(resourceDefs[0].url).toMatch(/^https?:\/\//);
    }
  });
});
