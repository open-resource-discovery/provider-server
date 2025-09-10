import { FastifyRequest, FastifyReply } from "fastify";
import { WebhookRouter } from "../webhookRouter.js";
import { UpdateScheduler } from "../../services/updateScheduler.js";
import { Logger } from "pino";
import { createHmac } from "crypto";

jest.mock("../../services/updateScheduler.js");

describe("WebhookRouter", () => {
  let webhookRouter: WebhookRouter;
  let mockUpdateScheduler: jest.Mocked<UpdateScheduler>;
  let mockLogger: jest.Mocked<Logger>;
  interface MockFastify {
    post: jest.Mock;
  }
  let mockFastify: MockFastify;
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;

  const defaultConfig = {
    secret: "test-secret",
    branch: "main",
    repository: "owner/repo",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockUpdateScheduler = {
      scheduleImmediateUpdate: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<UpdateScheduler>;

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    mockReply = {
      code: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      headers: {},
      body: {},
      rawBody: "",
    };

    mockFastify = {
      post: jest.fn(),
    };

    webhookRouter = new WebhookRouter(mockUpdateScheduler, defaultConfig, mockLogger);
  });

  describe("register", () => {
    it("should register webhook endpoint", () => {
      webhookRouter.register(mockFastify);

      expect(mockFastify.post).toHaveBeenCalledWith(
        "/api/v1/webhook/github",
        expect.objectContaining({
          config: { rawBody: true },
          preHandler: expect.any(Function),
          handler: expect.any(Function),
        }),
      );
    });
  });

  describe("signature verification", () => {
    let preHandler: (req: FastifyRequest, reply: FastifyReply, done: () => void) => void;

    beforeEach(() => {
      webhookRouter.register(mockFastify);
      const postCall = mockFastify.post.mock.calls[0][1];
      preHandler = postCall.preHandler;
    });

    it("should verify valid webhook signature", (done) => {
      const payload = JSON.stringify({ test: "data" });
      const hmac = createHmac("sha256", "test-secret");
      hmac.update(payload);
      const signature = `sha256=${hmac.digest("hex")}`;

      mockRequest.headers = { "x-hub-signature-256": signature };
      mockRequest.rawBody = payload;

      preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply, () => {
        expect(mockReply.code).not.toHaveBeenCalled();
        expect(mockReply.send).not.toHaveBeenCalled();
        done();
      });
    });

    it("should reject invalid signature", () => {
      mockRequest.headers = { "x-hub-signature-256": "sha256=invalid" };
      mockRequest.rawBody = JSON.stringify({ test: "data" });

      preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply, jest.fn());

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Invalid signature" });
    });

    it("should reject missing signature when secret is configured", () => {
      mockRequest.headers = {};
      mockRequest.rawBody = JSON.stringify({ test: "data" });

      preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply, jest.fn());

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Missing signature" });
    });

    it("should reject missing request body", () => {
      mockRequest.headers = { "x-hub-signature-256": "sha256=test" };
      mockRequest.rawBody = "";

      preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply, jest.fn());

      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Missing request body" });
    });

    it("should skip verification for manual triggers", (done) => {
      mockRequest.headers = { "x-manual-trigger": "true" };

      preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply, () => {
        expect(mockLogger.debug).toHaveBeenCalledWith("Manual trigger detected, skipping signature verification");
        expect(mockReply.code).not.toHaveBeenCalled();
        done();
      });
    });

    it("should skip verification when no secret configured", (done) => {
      const routerNoSecret = new WebhookRouter(
        mockUpdateScheduler,
        { ...defaultConfig, secret: undefined },
        mockLogger,
      );
      routerNoSecret.register(mockFastify);
      const noSecretPreHandler = mockFastify.post.mock.calls[1][1].preHandler;

      noSecretPreHandler(mockRequest as FastifyRequest, mockReply as FastifyReply, () => {
        expect(mockReply.code).not.toHaveBeenCalled();
        done();
      });
    });
  });

  describe("webhook handler", () => {
    let handler: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

    beforeEach(() => {
      webhookRouter.register(mockFastify);
      handler = mockFastify.post.mock.calls[0][1].handler;
    });

    it("should handle manual trigger successfully", async () => {
      mockRequest.headers = { "x-manual-trigger": "true" };

      await handler(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockUpdateScheduler.scheduleImmediateUpdate).toHaveBeenCalledWith(true);
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        status: "triggered",
        message: "Manual update triggered successfully",
      });
    });

    it("should handle manual trigger failure", async () => {
      mockRequest.headers = { "x-manual-trigger": "true" };
      mockUpdateScheduler.scheduleImmediateUpdate.mockRejectedValue(new Error("Update failed"));

      await handler(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        status: "error",
        message: "Failed to trigger update",
      });
    });

    it("should handle GitHub ping event", async () => {
      mockRequest.headers = { "x-github-event": "ping" };

      await handler(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        status: "ok",
        message: "Webhook ping received successfully",
      });
    });

    it("should process valid webhook for correct repository and branch", async () => {
      mockRequest.body = {
        ref: "refs/heads/main",
        repository: {
          full_name: "owner/repo",
          default_branch: "main",
        },
      };

      await handler(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockUpdateScheduler.scheduleImmediateUpdate).toHaveBeenCalledWith();
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        status: "triggered",
        message: "Content update has been triggered immediately",
      });
    });

    it("should reject webhook for different repository", async () => {
      mockRequest.body = {
        ref: "refs/heads/main",
        repository: {
          full_name: "different/repo",
          default_branch: "main",
        },
      };

      await handler(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockUpdateScheduler.scheduleImmediateUpdate).not.toHaveBeenCalled();
      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        status: "ignored",
        reason: "different repository",
      });
    });

    it("should handle case-insensitive repository comparison", async () => {
      mockRequest.body = {
        ref: "refs/heads/main",
        repository: {
          full_name: "Owner/Repo",
          default_branch: "main",
        },
      };

      await handler(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockUpdateScheduler.scheduleImmediateUpdate).toHaveBeenCalled();
      expect(mockReply.code).toHaveBeenCalledWith(200);
    });

    it("should reject webhook for different branch", async () => {
      mockRequest.body = {
        ref: "refs/heads/develop",
        repository: {
          full_name: "owner/repo",
          default_branch: "main",
        },
      };

      await handler(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockUpdateScheduler.scheduleImmediateUpdate).not.toHaveBeenCalled();
      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        status: "ignored",
        reason: "different branch",
      });
    });

    it("should handle update scheduler failure", async () => {
      mockRequest.body = {
        ref: "refs/heads/main",
        repository: {
          full_name: "owner/repo",
          default_branch: "main",
        },
      };
      mockUpdateScheduler.scheduleImmediateUpdate.mockRejectedValue(new Error("Scheduler error"));

      await handler(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        status: "error",
        message: "Failed to trigger update",
      });
    });
  });

  describe("verifySignature", () => {
    it("should handle signature length mismatch", () => {
      const routerWithLogging = new WebhookRouter(mockUpdateScheduler, defaultConfig, mockLogger);
      routerWithLogging.register(mockFastify);
      const preHandler = mockFastify.post.mock.calls[0][1].preHandler;

      mockRequest.headers = { "x-hub-signature-256": "sha256=short" };
      mockRequest.rawBody = "test payload";

      preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockLogger.debug).toHaveBeenCalled();
      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Invalid signature" });
    });

    it("should handle signature comparison errors", () => {
      const routerWithLogging = new WebhookRouter(mockUpdateScheduler, defaultConfig, mockLogger);
      routerWithLogging.register(mockFastify);
      const preHandler = mockFastify.post.mock.calls[0][1].preHandler;

      mockRequest.headers = { "x-hub-signature-256": "invalid-format" };
      mockRequest.rawBody = "test payload";

      preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockLogger.debug).toHaveBeenCalled();
      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Invalid signature" });
    });
  });
});
