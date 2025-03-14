import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fastify from "fastify";
import { setupAuthentication } from "src/middleware/authenticationSetup.js";
import { errorHandler } from "src/middleware/errorHandler.js";
import { OptAuthMethod } from "src/model/cli.js";
import { FastifyInstanceType } from "src/model/fastify.js";
// Mock bcrypt to avoid native module issues in tests
jest.mock("bcryptjs", () => ({
  compare: jest.fn().mockImplementation((password) => Promise.resolve(password === "secret")),
  hash: jest.fn().mockImplementation(() => Promise.resolve("$2b$10$hashedPassword")),
}));

describe("Authentication", () => {
  let server: FastifyInstanceType;
  const mockValidUsers = { admin: "$2b$10$hashedPassword" };
  const protectedRoute = "/ord/v1/documents/example";

  beforeAll(() => {
    // Mock environment variables
    process.env.BASIC_AUTH = JSON.stringify(mockValidUsers);
  });

  afterAll(() => {
    delete process.env.BASIC_AUTH;
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
