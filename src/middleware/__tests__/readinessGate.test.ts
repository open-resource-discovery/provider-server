import fastify from "fastify";
import { createReadinessGate } from "../readinessGate.js";
import { UpdateStateManager } from "../../services/updateStateManager.js";
import { PATH_CONSTANTS } from "../../constant.js";
import { Logger } from "pino";

describe("ReadinessGate Middleware", () => {
  let server: ReturnType<typeof fastify>;
  let mockLogger: Logger;
  let stateManager: UpdateStateManager;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    stateManager = new UpdateStateManager(mockLogger);
    server = fastify();
  });

  afterEach(async () => {
    await server.close();
    stateManager.removeAllListeners();
  });

  describe("without state manager (local mode)", () => {
    beforeEach(async () => {
      server.addHook("onRequest", createReadinessGate(undefined));
      server.get("/test", () => ({ status: "ok" }));
      await server.ready();
    });

    it("should pass through all requests immediately", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("route filtering", () => {
    beforeEach(async () => {
      server.addHook("onRequest", createReadinessGate(stateManager));
      server.get(PATH_CONSTANTS.WELL_KNOWN_ENDPOINT, () => ({ status: "ord-config" }));
      server.get(`${PATH_CONSTANTS.SERVER_PREFIX}/documents/test.json`, () => ({ status: "document" }));
      server.get("/status", () => ({ status: "status" }));
      server.get("/api/v1/webhook/github", () => ({ status: "webhook" }));
      server.get("/other", () => ({ status: "other" }));
      await server.ready();
    });

    it("should gate well-known endpoint", async () => {
      const response = await server.inject({
        method: "GET",
        url: PATH_CONSTANTS.WELL_KNOWN_ENDPOINT,
      });

      expect(response.statusCode).toBe(200);
    });

    it("should gate ord/v1 routes", async () => {
      const response = await server.inject({
        method: "GET",
        url: `${PATH_CONSTANTS.SERVER_PREFIX}/documents/test.json`,
      });

      expect(response.statusCode).toBe(200);
    });

    it("should not gate status endpoint", async () => {
      stateManager.startUpdate("validation");

      const response = await server.inject({
        method: "GET",
        url: "/status",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "status" });
    });

    it("should not gate webhook endpoint", async () => {
      stateManager.startUpdate("validation");

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/webhook/github",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "webhook" });
    });

    it("should not gate other routes", async () => {
      stateManager.startUpdate("validation");

      const response = await server.inject({
        method: "GET",
        url: "/other",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "other" });
    });
  });

  describe("ready state", () => {
    beforeEach(async () => {
      server.addHook("onRequest", createReadinessGate(stateManager));
      server.get(PATH_CONSTANTS.WELL_KNOWN_ENDPOINT, () => ({ status: "ready" }));
      await server.ready();
    });

    it("should pass through immediately when idle", async () => {
      const response = await server.inject({
        method: "GET",
        url: PATH_CONSTANTS.WELL_KNOWN_ENDPOINT,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ready" });
    });

    it("should pass through after update completes", async () => {
      stateManager.startUpdate("scheduler");
      stateManager.completeUpdate();

      const response = await server.inject({
        method: "GET",
        url: PATH_CONSTANTS.WELL_KNOWN_ENDPOINT,
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("waiting during update", () => {
    beforeEach(async () => {
      server.addHook("onRequest", createReadinessGate(stateManager));
      server.get(PATH_CONSTANTS.WELL_KNOWN_ENDPOINT, () => ({ status: "ready" }));
      await server.ready();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should wait and succeed when update completes", async () => {
      stateManager.startUpdate("validation");

      const responsePromise = server.inject({
        method: "GET",
        url: PATH_CONSTANTS.WELL_KNOWN_ENDPOINT,
      });

      setTimeout(() => {
        stateManager.completeUpdate();
      }, 100);

      jest.advanceTimersByTime(100);
      await jest.runAllTimersAsync();

      const response = await responsePromise;
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ready" });
    });

    it("should resolve on failed update and allow request through", async () => {
      stateManager.startUpdate("scheduler");

      const responsePromise = server.inject({
        method: "GET",
        url: PATH_CONSTANTS.WELL_KNOWN_ENDPOINT,
      });

      setTimeout(() => {
        stateManager.failUpdate("Test error");
      }, 100);

      jest.advanceTimersByTime(100);
      await jest.runAllTimersAsync();

      const response = await responsePromise;
      expect(response.statusCode).toBe(200);
    });
  });

  describe("timeout scenarios", () => {
    beforeEach(async () => {
      server.addHook("onRequest", createReadinessGate(stateManager));
      server.get(PATH_CONSTANTS.WELL_KNOWN_ENDPOINT, () => ({ status: "ready" }));
      await server.ready();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should return 503 on timeout", async () => {
      stateManager.startUpdate("validation");

      const responsePromise = server.inject({
        method: "GET",
        url: PATH_CONSTANTS.WELL_KNOWN_ENDPOINT,
      });

      // Advance past default timeout (5 minutes)
      jest.advanceTimersByTime(5 * 60 * 1000 + 1);
      await jest.runAllTimersAsync();

      const response = await responsePromise;
      expect(response.statusCode).toBe(503);

      const body = response.json();
      expect(body.error).toEqual({
        code: "TIMEOUT_ERROR",
        message: "Operation timed out while waiting for service to be ready",
        target: "content initialization",
        details: expect.arrayContaining([
          expect.objectContaining({
            code: "WAIT_TIMEOUT",
          }),
        ]),
      });
    });

    it("should log error on timeout", async () => {
      stateManager.startUpdate("scheduler");

      const responsePromise = server.inject({
        method: "GET",
        url: PATH_CONSTANTS.WELL_KNOWN_ENDPOINT,
      });

      jest.advanceTimersByTime(5 * 60 * 1000 + 1);
      await jest.runAllTimersAsync();

      const response = await responsePromise;

      expect(response.statusCode).toBe(503);
    });
  });

  describe("concurrent requests", () => {
    beforeEach(async () => {
      server.addHook("onRequest", createReadinessGate(stateManager));
      server.get(PATH_CONSTANTS.WELL_KNOWN_ENDPOINT, () => ({ status: "ready" }));
      await server.ready();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should handle multiple concurrent requests waiting on same update", async () => {
      stateManager.startUpdate("validation");

      const request1 = server.inject({
        method: "GET",
        url: PATH_CONSTANTS.WELL_KNOWN_ENDPOINT,
      });

      const request2 = server.inject({
        method: "GET",
        url: PATH_CONSTANTS.WELL_KNOWN_ENDPOINT,
      });

      const request3 = server.inject({
        method: "GET",
        url: PATH_CONSTANTS.WELL_KNOWN_ENDPOINT,
      });

      setTimeout(() => {
        stateManager.completeUpdate();
      }, 100);

      jest.advanceTimersByTime(100);
      await jest.runAllTimersAsync();

      const [response1, response2, response3] = await Promise.all([request1, request2, request3]);

      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);
      expect(response3.statusCode).toBe(200);
    });
  });
});
