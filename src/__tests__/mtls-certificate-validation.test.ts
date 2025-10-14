import { ProviderServerOptions, startProviderServer } from "../server.js";
import { OptAuthMethod, OptSourceType } from "../model/cli.js";
import { PATH_CONSTANTS } from "../constant.js";
import path from "path";
// Use native fetch from Node.js 18+

// Mock certificate loader to avoid actual network calls during tests
jest.mock("../services/certificateLoader.js", () => ({
  getCertificateLoader: jest.fn().mockResolvedValue({
    initialize: jest.fn().mockResolvedValue(undefined),
    getCertificateBySubject: jest.fn().mockReturnValue(undefined),
    getCACertificateDefinitions: jest.fn().mockReturnValue([
      {
        name: "SAP SSO CA G2",
        url: "https://aia.pki.co.sap.com/aia/SAP%20SSO%20CA%20G2.crt",
        crlUrl: "https://cdp.pki.co.sap.com/cdp/SAP%20SSO%20CA%20G2.crl",
      },
    ]),
  }),
}));

// Mock bcrypt for auth
jest.mock("bcryptjs", () => ({
  compare: jest.fn().mockImplementation((password) => Promise.resolve(password === "secret")),
  hash: jest.fn().mockImplementation(() => Promise.resolve("$2b$10$hashedPassword")),
}));

// Mock p-limit
jest.mock("p-limit", () => ({
  default:
    () =>
    (fn: () => unknown): unknown =>
      fn(),
}));

describe("mTLS Certificate Validation Tests", () => {
  const TEST_PORT = 8085;
  const TEST_HOST = "127.0.0.1";
  const SERVER_URL = `http://${TEST_HOST}:${TEST_PORT}`;
  const LOCAL_DIRECTORY = path.join(process.cwd(), "src/__tests__/test-files");

  let shutdownServer: () => Promise<void>;

  // Test certificate data from the provided headers
  const VALID_CERT_HEADERS = {
    "x-forwarded-client-cert":
      "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",
    "x-ssl-client-verify": "0",
    "x-ssl-client-subject-dn": "L0M9REUvTz1TQVAtQUcvQ049QzUzODg5MzM=",
    "x-ssl-client-subject-cn": "QzUzODg5MzM=",
    "x-ssl-client-issuer-dn": "L0M9REUvTD1XYWxsZG9yZi9PPVNBUCBTRS9DTj1TQVAgU1NPIENBIEcy",
    "x-ssl-client-root-ca-dn": "L0M9REUvTD1XYWxsZG9yZi9PPVNBUCBBRy9DTj1TQVAgR2xvYmFsIFJvb3QgQ0E=",
    "x-ssl-client-notafter": "260808084025Z",
    "x-ssl-client-notbefore": "250808084025Z",
    "x-ssl-client-session-id": "299D7BBEC593C958968AB7DEDE7A3BC104D1057D4DE806FDF0A2E9BE4800A41B",
  };

  // Helper functions
  function encodeBase64(str: string): string {
    return Buffer.from(str).toString("base64");
  }

  function createTestHeaders(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      ...VALID_CERT_HEADERS,
      ...overrides,
    };
  }

  function makeRequest(headers: Record<string, string>): Promise<Response> {
    return fetch(`${SERVER_URL}/ord/v1`, {
      headers: {
        ...headers,
        Accept: "application/json",
      },
    });
  }

  beforeAll(async () => {
    const options: ProviderServerOptions = {
      ordDirectory: LOCAL_DIRECTORY,
      ordDocumentsSubDirectory: PATH_CONSTANTS.DOCUMENTS_SUBDIRECTORY,
      sourceType: OptSourceType.Local,
      host: TEST_HOST,
      port: TEST_PORT,
      baseUrl: SERVER_URL,
      authentication: {
        methods: [OptAuthMethod.MTLS],
        sapCfMtls: {
          enabled: true,
          decodeBase64Headers: true,
        },
      },
      dataDir: "./test-data",
      updateDelay: 30000,
      statusDashboardEnabled: false,
    };

    shutdownServer = await startProviderServer(options);
  });

  afterAll(async () => {
    if (shutdownServer) {
      await shutdownServer();
    }
  });

  describe("Valid Certificate Tests", () => {
    test("should authenticate with valid certificate", async () => {
      const response = await makeRequest(createTestHeaders());
      expect(response.status).toBe(200);
    });

    test("should authenticate with different valid subject", async () => {
      const headers = createTestHeaders({
        "x-ssl-client-subject-dn": encodeBase64("/C=DE/O=SAP-AG/CN=C5388933"),
        "x-ssl-client-subject-cn": encodeBase64("C5388933"),
      });
      const response = await makeRequest(headers);
      expect(response.status).toBe(200);
    });
  });

  describe("Invalid Certificate Tests", () => {
    test("should reject request with invalid verification status", async () => {
      const headers = createTestHeaders({
        "x-ssl-client-verify": "1", // Non-zero means verification failed
      });
      const response = await makeRequest(headers);
      expect(response.status).toBe(401);
    });

    test("should reject request with missing verification status", async () => {
      const headers = { ...createTestHeaders() };
      delete headers["x-ssl-client-verify"];
      const response = await makeRequest(headers);
      expect(response.status).toBe(401);
    });

    test("should reject request with untrusted issuer", async () => {
      const headers = createTestHeaders({
        "x-ssl-client-issuer-dn": encodeBase64("/C=US/O=Untrusted CA/CN=Fake CA"),
      });
      const response = await makeRequest(headers);
      expect(response.status).toBe(401);
    });

    test("should reject request with untrusted subject", async () => {
      const headers = createTestHeaders({
        "x-ssl-client-subject-dn": encodeBase64("/C=US/O=Untrusted Org/CN=BadActor"),
        "x-ssl-client-subject-cn": encodeBase64("BadActor"),
      });
      const response = await makeRequest(headers);
      expect(response.status).toBe(401);
    });

    test("should reject request with invalid base64 encoding", async () => {
      const headers = createTestHeaders({
        "x-ssl-client-subject-dn": "NotBase64!!!",
      });
      const response = await makeRequest(headers);
      expect(response.status).toBe(401);
    });

    test("should reject request without certificate headers", async () => {
      const response = await makeRequest({});
      expect(response.status).toBe(401);
    });
  });

  describe("Edge Cases", () => {
    test("should handle missing optional headers", async () => {
      const headers = { ...createTestHeaders() };
      delete headers["x-ssl-client-root-ca-dn"];
      delete headers["x-ssl-client-session-id"];
      const response = await makeRequest(headers);
      expect(response.status).toBe(200);
    });

    test("should handle empty certificate header", async () => {
      const headers = createTestHeaders({
        "x-forwarded-client-cert": "",
      });
      const response = await makeRequest(headers);
      expect(response.status).toBe(200); // Should still work based on other headers
    });

    test("should handle malformed DN format", async () => {
      const headers = createTestHeaders({
        "x-ssl-client-subject-dn": encodeBase64("CN=Test,O=Org,C=DE"), // Different format
      });
      const response = await makeRequest(headers);
      expect(response.status).toBe(401);
    });
  });

  describe("Multiple Authentication Methods", () => {
    let multiAuthShutdown: () => Promise<void>;
    const MULTI_AUTH_PORT = 8086;
    const MULTI_AUTH_URL = `http://${TEST_HOST}:${MULTI_AUTH_PORT}`;

    beforeAll(async () => {
      const options: ProviderServerOptions = {
        ordDirectory: LOCAL_DIRECTORY,
        ordDocumentsSubDirectory: PATH_CONSTANTS.DOCUMENTS_SUBDIRECTORY,
        sourceType: OptSourceType.Local,
        host: TEST_HOST,
        port: MULTI_AUTH_PORT,
        baseUrl: MULTI_AUTH_URL,
        authentication: {
          methods: [OptAuthMethod.MTLS, OptAuthMethod.Basic],
          sapCfMtls: {
            enabled: true,
            decodeBase64Headers: true,
          },
          basicAuthUsers: { admin: "$2b$10$hashedPassword" },
        },
        dataDir: "./test-data",
        updateDelay: 30000,
        statusDashboardEnabled: false,
      };

      multiAuthShutdown = await startProviderServer(options);
    });

    afterAll(async () => {
      if (multiAuthShutdown) {
        await multiAuthShutdown();
      }
    });

    test("should authenticate with mTLS when both methods are enabled", async () => {
      const response = await fetch(`${MULTI_AUTH_URL}/ord/v1`, {
        headers: createTestHeaders(),
      });
      expect(response.status).toBe(200);
    });

    test("should authenticate with basic auth when mTLS fails", async () => {
      const response = await fetch(`${MULTI_AUTH_URL}/ord/v1`, {
        headers: {
          Authorization: "Basic " + Buffer.from("admin:secret").toString("base64"),
        },
      });
      expect(response.status).toBe(200);
    });

    test("should reject when both authentications fail", async () => {
      const response = await fetch(`${MULTI_AUTH_URL}/ord/v1`, {
        headers: {
          "x-ssl-client-verify": "1", // Invalid mTLS
          "Authorization": "Basic " + Buffer.from("admin:wrong").toString("base64"), // Wrong password
        },
      });
      expect(response.status).toBe(401);
    });
  });
});
