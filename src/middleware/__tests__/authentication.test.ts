import { describe, it, expect, jest, beforeAll, afterAll, beforeEach, afterEach } from "@jest/globals";
import fastify from "fastify";
import { setupAuthentication } from "src/middleware/authenticationSetup.js";
import { OptAuthMethod } from "src/model/cli.js";
import { errorHandler } from "src/middleware/errorHandler.js";
import { FastifyInstanceType } from "src/model/fastify.js";

describe("Authentication", () => {
  let server: FastifyInstanceType;
  const mockValidUsers = { admin: "secret" };
  const mockTrustedSubject = "CN=test.example.com,OU=Test,O=Example";
  const protectedRoute = "/ord/v1/documents/example";

  beforeAll(() => {
    // Mock environment variables
    process.env.APP_USERS = JSON.stringify(mockValidUsers);
    process.env.CMP_DEV_INFO_ENDPOINT = "https://test-endpoint.com";

    // Mock fetch for trusted subjects
    const mockFetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ certSubject: mockTrustedSubject }),
      }),
    );
    global.fetch = mockFetch as jest.MockedFunction<typeof fetch>;
  });

  afterAll(() => {
    delete process.env.APP_USERS;
    delete process.env.CMP_DEV_INFO_ENDPOINT;
    jest.restoreAllMocks();
  });

  describe("Open - without authentication", () => {
    beforeEach(async () => {
      server = fastify() as FastifyInstanceType;
      server.setErrorHandler(errorHandler);
      await setupAuthentication(server, {
        authMethods: [OptAuthMethod.Open],
      });
      // Add a test route
      server.get(protectedRoute, () => {
        return { status: "ok" };
      });
      await server.ready();
    });

    afterEach(async () => {
      await server.close();
    });

    it("should have access without credentials", async () => {
      const response = await server.inject({
        method: "GET",
        url: protectedRoute,
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("Basic Authentication", () => {
    beforeEach(async () => {
      server = fastify() as FastifyInstanceType;
      server.setErrorHandler(errorHandler);
      await setupAuthentication(server, {
        authMethods: [OptAuthMethod.Basic],
        validUsers: mockValidUsers,
      });
      // Add a test route
      server.get(protectedRoute, () => {
        return { status: "ok" };
      });
      await server.ready();
    });

    afterEach(async () => {
      await server.close();
    });

    it("should authenticate with valid credentials", async () => {
      const credentials = Buffer.from("admin:secret").toString("base64");
      const response = await server.inject({
        method: "GET",
        url: protectedRoute,
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject with invalid credentials", async () => {
      const credentials = Buffer.from("admin:wrong").toString("base64");
      const response = await server.inject({
        method: "GET",
        url: protectedRoute,
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject without credentials", async () => {
      const response = await server.inject({
        method: "GET",
        url: protectedRoute,
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
