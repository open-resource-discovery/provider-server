import fastify from "fastify";
import { createSapCfMtlsValidator } from "src/middleware/sapCfMtlsValidation.js";
import { errorHandler } from "src/middleware/errorHandler.js";
import { FastifyInstanceType } from "src/model/fastify.js";

const encodeBase64 = (value: string): string => Buffer.from(value).toString("base64");

describe("sapCfMtlsValidation", () => {
  let server: FastifyInstanceType;

  const trustedIssuers = ["CN=SAP SSO CA G2,O=SAP SE,L=Walldorf,C=DE"];
  const trustedSubjects = ["CN=C5998933a,O=SAP-AG,C=DE"];

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
        trustedIssuers,
        trustedSubjects,
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
          "x-ssl-client-issuer-dn": encodeBase64("/C=DE/L=Walldorf/O=SAP SE/CN=SAP SSO CA G2"),
          "x-ssl-client-subject-dn": encodeBase64("/C=DE/O=SAP-AG/CN=C5998933a"),
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
          "x-ssl-client-issuer-dn": encodeBase64("CN=SAP SSO CA G2,O=SAP SE,L=Walldorf,C=DE"),
          "x-ssl-client-subject-dn": encodeBase64("CN=C5998933a,O=SAP-AG,C=DE"),
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject request with missing issuer header", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-ssl-client-subject-dn": encodeBase64("/C=DE/O=SAP-AG/CN=C5998933a"),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject request with missing subject header", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-ssl-client-issuer-dn": encodeBase64("/C=DE/L=Walldorf/O=SAP SE/CN=SAP SSO CA G2"),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject request with untrusted issuer", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-ssl-client-issuer-dn": encodeBase64("/C=US/O=Untrusted CA/CN=Fake CA"),
          "x-ssl-client-subject-dn": encodeBase64("/C=DE/O=SAP-AG/CN=C5998933a"),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject request with untrusted subject", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-ssl-client-issuer-dn": encodeBase64("/C=DE/L=Walldorf/O=SAP SE/CN=SAP SSO CA G2"),
          "x-ssl-client-subject-dn": encodeBase64("/C=US/O=Untrusted Org/CN=BadActor"),
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("with empty trusted lists", () => {
    it("should authenticate any request when no trusted issuers configured", async () => {
      const mtlsValidator = createSapCfMtlsValidator({
        trustedIssuers: [],
        trustedSubjects,
      });

      server.addHook("onRequest", mtlsValidator);
      server.get("/test", () => ({ success: true }));
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-ssl-client-issuer-dn": encodeBase64("/C=US/O=Any CA/CN=Any Issuer"),
          "x-ssl-client-subject-dn": encodeBase64("/C=DE/O=SAP-AG/CN=C5998933a"),
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should authenticate any request when no trusted subjects configured", async () => {
      const mtlsValidator = createSapCfMtlsValidator({
        trustedIssuers,
        trustedSubjects: [],
      });

      server.addHook("onRequest", mtlsValidator);
      server.get("/test", () => ({ success: true }));
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-ssl-client-issuer-dn": encodeBase64("/C=DE/L=Walldorf/O=SAP SE/CN=SAP SSO CA G2"),
          "x-ssl-client-subject-dn": encodeBase64("/C=US/O=Any Org/CN=AnyUser"),
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should still require headers when both lists are empty", async () => {
      const mtlsValidator = createSapCfMtlsValidator({
        trustedIssuers: [],
        trustedSubjects: [],
      });

      server.addHook("onRequest", mtlsValidator);
      server.get("/test", () => ({ success: true }));
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {},
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("with multiple trusted values", () => {
    beforeEach(async () => {
      const mtlsValidator = createSapCfMtlsValidator({
        trustedIssuers: ["CN=CA1,O=Org1,C=DE", "CN=CA2,O=Org2,C=US"],
        trustedSubjects: ["CN=Service1,O=Org1,C=DE", "CN=Service2,O=Org2,C=US"],
      });

      server.addHook("onRequest", mtlsValidator);
      server.get("/test", () => ({ success: true }));
      await server.ready();
    });

    it("should authenticate with first trusted issuer", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-ssl-client-issuer-dn": encodeBase64("CN=CA1,O=Org1,C=DE"),
          "x-ssl-client-subject-dn": encodeBase64("CN=Service1,O=Org1,C=DE"),
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should authenticate with second trusted issuer", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-ssl-client-issuer-dn": encodeBase64("CN=CA2,O=Org2,C=US"),
          "x-ssl-client-subject-dn": encodeBase64("CN=Service2,O=Org2,C=US"),
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should allow mixing trusted issuers and subjects", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-ssl-client-issuer-dn": encodeBase64("CN=CA1,O=Org1,C=DE"),
          "x-ssl-client-subject-dn": encodeBase64("CN=Service2,O=Org2,C=US"),
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
