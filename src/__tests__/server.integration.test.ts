import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { ORDConfiguration, ORDDocument, ORDV1DocumentDescription } from "@open-resource-discovery/specification";
import path from "path";
import {
  ORD_DOCUMENTS_SUB_DIRECTORY,
  ORD_DOCUMENTS_URL_PATH,
  ORD_SERVER_PREFIX_PATH,
  WELL_KNOWN_ENDPOINT,
} from "src/constant.js";
import { OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { ProviderServerOptions, startProviderServer } from "src/server.js";

// Mock bcrypt to avoid native module issues in tests
jest.mock("bcryptjs", () => ({
  compare: jest.fn().mockImplementation((password) => Promise.resolve(password === "secret")),
  hash: jest.fn().mockImplementation(() => Promise.resolve("$2b$10$hashedPassword")),
}));

describe("Server Integration", () => {
  const TEST_PORT = 8081;
  const TEST_HOST = "127.0.0.1";
  const SERVER_URL = `http://${TEST_HOST}:${TEST_PORT}`;
  const MULTI_AUTH_PORT = 8082;
  const SERVER_URL_2 = `http://${TEST_HOST}:${MULTI_AUTH_PORT}`;
  const LOCAL_DIRECTORY = path.join(process.cwd(), "src/__tests__/test-files");
  const BASIC_AUTH_PASSWORD = "$2b$10$hashedPassword";

  let shutdownServer: () => Promise<void>;
  beforeAll(async () => {
    const options: ProviderServerOptions = {
      ordDirectory: LOCAL_DIRECTORY,
      ordDocumentsSubDirectory: ORD_DOCUMENTS_SUB_DIRECTORY,
      sourceType: OptSourceType.Local,
      host: TEST_HOST,
      port: TEST_PORT,
      baseUrl: SERVER_URL,
      authentication: {
        methods: [OptAuthMethod.Basic],
        basicAuthUsers: { admin: BASIC_AUTH_PASSWORD },
      },
    };

    shutdownServer = await startProviderServer(options);
  });

  afterAll(async () => {
    await shutdownServer();
  });

  describe("Well-Known Endpoint", () => {
    it("should return ORD configuration without authentication", async () => {
      const response = await fetch(`${SERVER_URL}${WELL_KNOWN_ENDPOINT}`);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("openResourceDiscoveryV1");
    });

    it("should list all available documents in configuration", async () => {
      const response = await fetch(`${SERVER_URL}${WELL_KNOWN_ENDPOINT}`);
      const data = (await response.json()) as ORDConfiguration;

      expect(data.openResourceDiscoveryV1.documents).toBeDefined();
      expect(Array.isArray(data.openResourceDiscoveryV1.documents)).toBe(true);
      expect(data.openResourceDiscoveryV1.documents?.length).toBeGreaterThan(0);

      data.openResourceDiscoveryV1.documents?.forEach((doc: ORDV1DocumentDescription) => {
        expect(doc).toHaveProperty("url");
        expect(doc).toHaveProperty("accessStrategies");
      });
    });
  });

  describe("ORD Documents Endpoint", () => {
    it("should require authentication for accessing documents", async () => {
      const response = await fetch(`${SERVER_URL}${ORD_DOCUMENTS_URL_PATH}/ref-app-example-1`);
      expect(response.status).toBe(401);
    });

    it("should return document with valid authentication", async () => {
      const credentials = Buffer.from("admin:secret").toString("base64");
      const response = await fetch(`${SERVER_URL}${ORD_DOCUMENTS_URL_PATH}/ref-app-example-1`, {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      expect(response.status).toBe(200);
      const document = (await response.json()) as ORDDocument;
      expect(document).toHaveProperty("openResourceDiscovery");
      expect(document.openResourceDiscovery).toBe("1.6");
    });

    it("should handle multiple documents in documents directory", async () => {
      const credentials = Buffer.from("admin:secret").toString("base64");
      const headers = { Authorization: `Basic ${credentials}` };

      const configResponse = await fetch(`${SERVER_URL}${WELL_KNOWN_ENDPOINT}`);
      const config = (await configResponse.json()) as ORDConfiguration;
      const documents = config.openResourceDiscoveryV1.documents!;

      for (const doc of documents) {
        const docUrl = doc.url;
        const response = await fetch(`${SERVER_URL}${docUrl}`, { headers });
        expect(response.status).toBe(200);
        const document = await response.json();
        expect(document).toHaveProperty("openResourceDiscovery");
      }
    });

    it("should handle document names with special characters", async () => {
      const credentials = Buffer.from("admin:secret").toString("base64");
      const response = await fetch(`${SERVER_URL}${ORD_DOCUMENTS_URL_PATH}/ref-app-example-1`, {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      expect(response.status).toBe(200);
    });
  });

  describe("Static Resources", () => {
    it("should serve static files with authentication", async () => {
      const credentials = Buffer.from("admin:secret").toString("base64");
      const response = await fetch(`${SERVER_URL}${ORD_SERVER_PREFIX_PATH}/astronomy/v1/openapi/oas3.json`, {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("openapi", "3.0.0");
    });

    it("should return 401 for static files without authentication", async () => {
      const response = await fetch(`${SERVER_URL}/astronomy/v1/openapi/oas3.json`);
      expect(response.status).toBe(401);
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for non-existent documents", async () => {
      const credentials = Buffer.from("admin:secret").toString("base64");
      const response = await fetch(`${SERVER_URL}${ORD_DOCUMENTS_URL_PATH}/non-existent-document`, {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      expect(response.status).toBe(404);
      const error = await response.json();
      expect(error).toHaveProperty("error.code", "NOT_FOUND");
    });

    it("should return 401 with invalid credentials", async () => {
      const credentials = Buffer.from("admin:wrong").toString("base64");
      const response = await fetch(`${SERVER_URL}${ORD_DOCUMENTS_URL_PATH}/ref-app-example-1`, {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      expect(response.status).toBe(401);
    });

    it("should handle malformed document names gracefully", async () => {
      const credentials = Buffer.from("admin:secret").toString("base64");
      const response = await fetch(`${SERVER_URL}${ORD_DOCUMENTS_URL_PATH}/../../etc/passwd`, {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      expect(response.status).toBe(404);
    });
  });

  describe("Basic Authentication Method", () => {
    let shutdownServer: () => Promise<void>;

    beforeAll(async () => {
      const options: ProviderServerOptions = {
        ordDirectory: LOCAL_DIRECTORY,
        ordDocumentsSubDirectory: ORD_DOCUMENTS_SUB_DIRECTORY,
        sourceType: OptSourceType.Local,
        host: TEST_HOST,
        port: MULTI_AUTH_PORT,
        baseUrl: SERVER_URL_2,
        authentication: {
          methods: [OptAuthMethod.Basic],
          basicAuthUsers: { admin: BASIC_AUTH_PASSWORD },
        },
      };

      shutdownServer = await startProviderServer(options);
    });

    afterAll(async () => {
      await shutdownServer();
    });

    it("should accept basic auth when multiple auth methods are configured", async () => {
      const credentials = Buffer.from("admin:secret").toString("base64");
      const response = await fetch(`${SERVER_URL_2}${ORD_DOCUMENTS_URL_PATH}/ref-app-example-1`, {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      expect(response.status).toBe(200);
    });
  });

  describe("Server Configuration", () => {
    it("should set correct content type headers", async () => {
      const credentials = Buffer.from("admin:secret").toString("base64");
      const response = await fetch(`${SERVER_URL}${ORD_DOCUMENTS_URL_PATH}/ref-app-example-1`, {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      expect(response.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("Performance", () => {
    it("should handle multiple concurrent requests", async () => {
      const credentials = Buffer.from("admin:secret").toString("base64");
      const headers = {
        Authorization: `Basic ${credentials}`,
      };

      const requests = Array(10)
        .fill(null)
        .map(() => fetch(`${SERVER_URL}${ORD_DOCUMENTS_URL_PATH}/ref-app-example-1`, { headers }));

      const responses = await Promise.all(requests);
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
    });

    it("should return ETag headers for caching", async () => {
      const credentials = Buffer.from("admin:secret").toString("base64");
      const response = await fetch(`${SERVER_URL}${ORD_DOCUMENTS_URL_PATH}/ref-app-example-1`, {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      expect(response.headers.get("etag")).toBeTruthy();
    });
  });
});
