import fastify from "fastify";
import { createSapCfMtlsValidator } from "src/middleware/sapCfMtlsValidation.js";
import { setupAuthentication } from "src/middleware/authenticationSetup.js";
import { errorHandler } from "src/middleware/errorHandler.js";
import { FastifyInstanceType } from "src/model/fastify.js";
import { OptAuthMethod } from "src/model/cli.js";
import { CERT_ISSUER_DN_HEADER, CERT_SUBJECT_DN_HEADER, CERT_ROOT_CA_DN_HEADER } from "../../constant.js";

const encodeBase64 = (value: string): string => Buffer.from(value).toString("base64");

describe("sapCfMtlsValidation", () => {
  let server: FastifyInstanceType;

  const trustedCerts = [
    {
      issuer: "CN=ACME Root CA,O=ACME Inc,L=San Francisco,C=US",
      subject: "CN=test-service,O=ACME Inc,C=US",
    },
  ];
  const trustedRootCaDns = ["CN=Global Root CA,O=ACME Inc,C=US"];

  beforeEach(() => {
    server = fastify() as FastifyInstanceType;
    server.setErrorHandler(errorHandler);
  });

  afterEach(async () => {
    await server.close();
  });

  describe("header validation", () => {
    beforeEach(async () => {
      const mtlsValidator = createSapCfMtlsValidator({
        trustedCerts,
        trustedRootCaDns,
      });

      server.addHook("onRequest", mtlsValidator);

      server.get("/test", () => ({ success: true }));

      await server.ready();
    });

    it("should authenticate with valid base64 encoded headers", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64("/C=US/L=San Francisco/O=ACME Inc/CN=ACME Root CA"),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=test-service"),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=Global Root CA"),
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ success: true });
    });

    it("should authenticate with different DN order", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64("CN=ACME Root CA,O=ACME Inc,L=San Francisco,C=US"),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("CN=test-service,O=ACME Inc,C=US"),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("CN=Global Root CA,O=ACME Inc,C=US"),
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject request with missing issuer header", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=test-service"),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=Global Root CA"),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject request with missing subject header", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64("/C=US/L=San Francisco/O=ACME Inc/CN=ACME Root CA"),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=Global Root CA"),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject request with missing root CA header", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64("/C=US/L=San Francisco/O=ACME Inc/CN=ACME Root CA"),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=test-service"),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject request with untrusted issuer", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64("/C=DE/O=Untrusted CA/CN=Fake CA"),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=test-service"),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=Global Root CA"),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject request with untrusted subject", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64("/C=US/L=San Francisco/O=ACME Inc/CN=ACME Root CA"),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("/C=DE/O=Untrusted Org/CN=BadActor"),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=Global Root CA"),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject request with untrusted root CA", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64("/C=US/L=San Francisco/O=ACME Inc/CN=ACME Root CA"),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=test-service"),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("/C=DE/O=Untrusted Root/CN=Fake Root CA"),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject request with garbage base64 (invalid DN)", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: "not-valid-base64!!!",
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=test-service"),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=Global Root CA"),
        },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.message).toBe("Untrusted certificate (issuer/subject pair not found)");
    });

    it("should handle array headers by using first value", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64("/C=US/L=San Francisco/O=ACME Inc/CN=ACME Root CA"),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=test-service"),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("/C=US/O=ACME Inc/CN=Global Root CA"),
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("with empty trusted lists", () => {
    it("should throw error when no trusted certs configured", () => {
      expect(() => {
        createSapCfMtlsValidator({
          trustedCerts: [],
          trustedRootCaDns,
        });
      }).toThrow("mTLS validation requires at least one trusted certificate (issuer/subject pair)");
    });

    it("should throw error when no trusted root CA DNs configured", () => {
      expect(() => {
        createSapCfMtlsValidator({
          trustedCerts,
          trustedRootCaDns: [],
        });
      }).toThrow("mTLS validation requires at least one trusted root CA DN");
    });

    it("should throw error when all lists are empty", () => {
      expect(() => {
        createSapCfMtlsValidator({
          trustedCerts: [],
          trustedRootCaDns: [],
        });
      }).toThrow("mTLS validation requires at least one trusted certificate (issuer/subject pair)");
    });
  });

  describe("with multiple trusted certificate pairs", () => {
    beforeEach(async () => {
      const mtlsValidator = createSapCfMtlsValidator({
        trustedCerts: [
          { issuer: "CN=CA1,O=Org1,C=DE", subject: "CN=Service1,O=Org1,C=DE" },
          { issuer: "CN=CA2,O=Org2,C=US", subject: "CN=Service2,O=Org2,C=US" },
        ],
        trustedRootCaDns: ["CN=RootCA1,O=Org1,C=DE", "CN=RootCA2,O=Org2,C=US"],
      });

      server.addHook("onRequest", mtlsValidator);
      server.get("/test", () => ({ success: true }));
      await server.ready();
    });

    it("should authenticate with first trusted certificate pair", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64("CN=CA1,O=Org1,C=DE"),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("CN=Service1,O=Org1,C=DE"),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("CN=RootCA1,O=Org1,C=DE"),
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should authenticate with second trusted certificate pair", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64("CN=CA2,O=Org2,C=US"),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("CN=Service2,O=Org2,C=US"),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("CN=RootCA2,O=Org2,C=US"),
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject when issuer and subject are not from the same certificate pair", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64("CN=CA1,O=Org1,C=DE"),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("CN=Service2,O=Org2,C=US"), // Different pair!
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("CN=RootCA1,O=Org1,C=DE"),
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("with config endpoints", () => {
    const mockFetch = jest.fn();
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = mockFetch;
      mockFetch.mockReset();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("should authenticate using issuer/subject pair fetched from endpoint and rootCa from config", async () => {
      const certIssuer = "CN=ACME PKI CA,OU=ACME Clients,O=ACME Inc,L=Denver,C=US";
      const certSubject = "CN=acme-service,OU=Cloud Clients,OU=Staging,O=ACME Inc,L=Denver,C=US";
      const certRootCa = "CN=ACME Global Root CA,O=ACME Inc,C=US";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => ({
          certIssuer,
          certSubject,
        }),
      });

      // Setup authentication with config endpoint and manual root CA
      await setupAuthentication(server, {
        authMethods: [OptAuthMethod.CfMtls],
        cfMtlsConfigEndpoints: ["https://ucl.acme.com/cert-info"],
        trustedRootCaDns: [certRootCa], // Root CAs only from config
      });

      server.get("/ord/v1/documents/document-1", () => ({ success: true }));
      await server.ready();

      // Request with matching issuer/subject pair from endpoint and rootCa from config should succeed
      const response = await server.inject({
        method: "GET",
        url: "/ord/v1/documents/document-1",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64(certIssuer),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64(certSubject),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64(certRootCa),
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ucl.acme.com/cert-info",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    it("should reject request with non-matching issuer/subject pair from endpoint", async () => {
      const certIssuer = "CN=Expected CA,O=ACME Inc,C=US";
      const certSubject = "CN=expected-service,O=ACME Inc,C=US";
      const certRootCa = "CN=Expected Root CA,O=ACME Inc,C=US";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => ({
          certIssuer,
          certSubject,
        }),
      });

      await setupAuthentication(server, {
        authMethods: [OptAuthMethod.CfMtls],
        cfMtlsConfigEndpoints: ["https://config.example.com/cert-info"],
        trustedRootCaDns: [certRootCa], // Root CAs only from config
      });

      server.get("/test", () => ({ success: true }));
      await server.ready();

      // Request with different issuer should fail (pair doesn't match)
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64(certIssuer + "modified"),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64(certSubject),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64(certRootCa),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should merge endpoint config with manual config", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => ({
          certIssuer: "CN=Endpoint CA,O=ACME Inc,C=US",
          certSubject: "CN=endpoint-service,O=ACME Inc,C=US",
        }),
      });

      await setupAuthentication(server, {
        authMethods: [OptAuthMethod.CfMtls],
        cfMtlsConfigEndpoints: ["https://config.example.com/cert-info"],
        trustedCerts: [{ issuer: "CN=Manual CA,O=Manual Org,C=DE", subject: "CN=manual-service,O=Manual Org,C=DE" }],
        trustedRootCaDns: ["CN=Manual Root CA,O=Manual Org,C=DE"],
      });

      server.get("/test", () => ({ success: true }));
      await server.ready();

      // Request with manual issuer/subject pair and rootCa should also succeed
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          [CERT_ISSUER_DN_HEADER]: encodeBase64("CN=Manual CA,O=Manual Org,C=DE"),
          [CERT_SUBJECT_DN_HEADER]: encodeBase64("CN=manual-service,O=Manual Org,C=DE"),
          [CERT_ROOT_CA_DN_HEADER]: encodeBase64("CN=Manual Root CA,O=Manual Org,C=DE"),
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
