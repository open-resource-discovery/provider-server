import statusRouter from "../statusRouter.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { StatusService } from "../../services/statusService.js";
import type { FileSystemManager } from "../../services/fileSystemManager.js";
import type { UpdateScheduler } from "../../services/updateScheduler.js";

describe("statusRouter", () => {
  let mockFastify: jest.Mocked<FastifyInstance>;
  let mockStatusService: jest.Mocked<StatusService>;
  let mockFileSystemManager: jest.Mocked<FileSystemManager> | null;
  let mockUpdateScheduler: jest.Mocked<UpdateScheduler> | null;
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: jest.Mocked<FastifyReply>;
  let routerOptions: {
    statusService: StatusService;
    fileSystemManager: FileSystemManager | null;
    updateScheduler: UpdateScheduler | null;
    statusDashboardEnabled?: boolean;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockStatusService = {
      getStatus: jest.fn().mockResolvedValue({
        version: "1.0.0",
        settings: { sourceType: "github" },
        systemMetrics: { memory: { used: 100, total: 200 } },
      }),
    } as unknown as jest.Mocked<StatusService>;

    mockFileSystemManager = null;
    mockUpdateScheduler = null;

    mockRequest = {};
    mockReply = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      code: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis(),
      sendFile: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<FastifyReply>;

    mockFastify = {
      get: jest.fn(),
      register: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<FastifyInstance>;

    routerOptions = {
      statusService: mockStatusService,
      fileSystemManager: mockFileSystemManager,
      updateScheduler: mockUpdateScheduler,
      statusDashboardEnabled: true,
    };
  });

  describe("route registration", () => {
    it("should register all required routes", async () => {
      await statusRouter(mockFastify, routerOptions);

      expect(mockFastify.get).toHaveBeenCalledTimes(3);
      expect(mockFastify.get).toHaveBeenCalledWith("/api/v1/status", expect.any(Function));
      expect(mockFastify.get).toHaveBeenCalledWith("/status", { logLevel: "error" }, expect.any(Function));
      expect(mockFastify.get).toHaveBeenCalledWith("/status/*", { logLevel: "error" }, expect.any(Function));
    });
  });

  describe("/api/v1/status endpoint", () => {
    it("should return status data", async () => {
      await statusRouter(mockFastify, routerOptions);

      const handler = mockFastify.get.mock.calls.find((call) => call[0] === "/api/v1/status")?.[1] as unknown as (
        req: FastifyRequest,
        reply: FastifyReply,
      ) => Promise<unknown>;

      const result = await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockStatusService.getStatus).toHaveBeenCalled();
      expect(result).toEqual({
        version: "1.0.0",
        settings: { sourceType: "github" },
        systemMetrics: { memory: { used: 100, total: 200 } },
      });
    });

    it("should handle status service errors", async () => {
      mockStatusService.getStatus.mockRejectedValue(new Error("Status error"));

      await statusRouter(mockFastify, routerOptions);

      const handler = mockFastify.get.mock.calls.find((call) => call[0] === "/api/v1/status")?.[1] as unknown as (
        req: FastifyRequest,
        reply: FastifyReply,
      ) => Promise<unknown>;

      await expect(handler(mockRequest as FastifyRequest, mockReply)).rejects.toThrow("Status error");
    });
  });

  describe("/status endpoint", () => {
    it("should serve the UI when dashboard is enabled", async () => {
      await statusRouter(mockFastify, routerOptions);

      const routeConfig = mockFastify.get.mock.calls.find((call) => call[0] === "/status");
      const handler = routeConfig?.[2] as unknown as (req: FastifyRequest, reply: FastifyReply) => void;

      handler(mockRequest as FastifyRequest, mockReply);

      expect(mockReply.sendFile).toHaveBeenCalledWith("index.html");
    });

    it("should redirect to well-known endpoint when dashboard is disabled", async () => {
      routerOptions.statusDashboardEnabled = false;

      await statusRouter(mockFastify, routerOptions);

      const routeConfig = mockFastify.get.mock.calls.find((call) => call[0] === "/status");
      const handler = routeConfig?.[2] as unknown as (req: FastifyRequest, reply: FastifyReply) => void;

      handler(mockRequest as FastifyRequest, mockReply);

      expect(mockReply.redirect).toHaveBeenCalledWith("/.well-known/open-resource-discovery");
    });
  });

  describe("edge cases", () => {
    it("should work without fileSystemManager", async () => {
      routerOptions.fileSystemManager = null;
      await statusRouter(mockFastify, routerOptions);

      expect(mockFastify.get).toHaveBeenCalledTimes(3);
    });

    it("should work without updateScheduler", async () => {
      routerOptions.updateScheduler = null;
      await statusRouter(mockFastify, routerOptions);

      expect(mockFastify.get).toHaveBeenCalledTimes(3);
    });

    it("should work with undefined statusDashboardEnabled", async () => {
      delete routerOptions.statusDashboardEnabled;
      await statusRouter(mockFastify, routerOptions);

      expect(mockFastify.get).toHaveBeenCalledTimes(3);
    });
  });
});
