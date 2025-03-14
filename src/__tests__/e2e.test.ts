import { describe, expect, it } from "@jest/globals";
import { ORDConfiguration, ORDDocument } from "@sap/open-resource-discovery";
import path from "path";
import { OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { startProviderServer } from "src/server.js";

// Mock bcrypt to avoid native module issues in tests
jest.mock("bcryptjs", () => ({
  compare: jest.fn().mockImplementation((password) => Promise.resolve(password === "secret")),
  hash: jest.fn().mockImplementation(() => Promise.resolve("$2b$10$hashedPassword")),
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
      sourceType: OptSourceType.Local,
      baseUrl: SERVER_URL,
      host: "0.0.0.0",
      port: TEST_PORT,
      authentication: {
        methods: [OptAuthMethod.Basic],
        basicAuthUsers: { admin: BASIC_AUTH_PASSWORD },
      },
    });
  });

  afterAll(async () => {
    await shutdownServer();
  });

  it("should complete full user journey", async () => {
    // 1. Discover API
    const configResponse = await fetch(`${SERVER_URL}/.well-known/open-resource-discovery`);
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
    expect(resourceResponse.status).toBe(200);
  });
});
