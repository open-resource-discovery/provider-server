import statusRouter from "../statusRouter.js";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StatusService } from "../../services/statusService.js";
import { FileSystemManager } from "../../services/fileSystemManager.js";
import { UpdateScheduler } from "../../services/updateScheduler.js";
import fs from "node:fs";
import path from "node:path";
import { log } from "../../util/logger.js";

jest.mock("node:fs");
jest.mock("../../util/logger.js");

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
    } as unknown as jest.Mocked<FastifyReply>;

    mockFastify = {
      get: jest.fn(),
    } as unknown as jest.Mocked<FastifyInstance>;

    routerOptions = {
      statusService: mockStatusService,
      fileSystemManager: mockFileSystemManager,
      updateScheduler: mockUpdateScheduler,
      statusDashboardEnabled: true,
    };
  });

  describe("route registration", () => {
    it("should register all required routes", () => {
      const doneMock = jest.fn();
      statusRouter(mockFastify, routerOptions, doneMock);

      expect(mockFastify.get).toHaveBeenCalledTimes(4);
      expect(mockFastify.get).toHaveBeenCalledWith("/api/v1/status", expect.any(Function));
      expect(mockFastify.get).toHaveBeenCalledWith("/status", { logLevel: "error" }, expect.any(Function));
      expect(mockFastify.get).toHaveBeenCalledWith("/css/status.css", { logLevel: "error" }, expect.any(Function));
      expect(mockFastify.get).toHaveBeenCalledWith("/js/status.js", { logLevel: "error" }, expect.any(Function));
      expect(doneMock).toHaveBeenCalled();
    });
  });

  describe("/api/v1/status endpoint", () => {
    it("should return status data", async () => {
      statusRouter(mockFastify, routerOptions, jest.fn());

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

      statusRouter(mockFastify, routerOptions, jest.fn());

      const handler = mockFastify.get.mock.calls.find((call) => call[0] === "/api/v1/status")?.[1] as unknown as (
        req: FastifyRequest,
        reply: FastifyReply,
      ) => Promise<unknown>;

      await expect(handler(mockRequest as FastifyRequest, mockReply)).rejects.toThrow("Status error");
    });
  });

  describe("/status endpoint", () => {
    it("should serve HTML when dashboard is enabled", () => {
      const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
      mockReadFileSync.mockReturnValue("<html>Status Page</html>");

      statusRouter(mockFastify, routerOptions, jest.fn());

      const routeConfig = mockFastify.get.mock.calls.find((call) => call[0] === "/status");
      const handler = routeConfig?.[2] as unknown as (req: FastifyRequest, reply: FastifyReply) => void;

      handler(mockRequest as FastifyRequest, mockReply);

      const expectedPath = path.join(process.cwd(), "public", "status.html");
      expect(mockReadFileSync).toHaveBeenCalledWith(expectedPath, "utf-8");
      expect(mockReply.type).toHaveBeenCalledWith("text/html");
      expect(mockReply.send).toHaveBeenCalledWith("<html>Status Page</html>");
    });

    it("should redirect to well-known endpoint when dashboard is disabled", () => {
      routerOptions.statusDashboardEnabled = false;

      statusRouter(mockFastify, routerOptions, jest.fn());

      const routeConfig = mockFastify.get.mock.calls.find((call) => call[0] === "/status");
      const handler = routeConfig?.[2] as unknown as (req: FastifyRequest, reply: FastifyReply) => void;

      const result = handler(mockRequest as FastifyRequest, mockReply);

      expect(mockReply.redirect).toHaveBeenCalledWith("/.well-known/open-resource-discovery");
      expect(result).toBe(mockReply);
    });

    it("should handle file read errors", () => {
      const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
      const fileError = new Error("File not found");
      mockReadFileSync.mockImplementation(() => {
        throw fileError;
      });

      statusRouter(mockFastify, routerOptions, jest.fn());

      const routeConfig = mockFastify.get.mock.calls.find((call) => call[0] === "/status");
      const handler = routeConfig?.[2] as unknown as (req: FastifyRequest, reply: FastifyReply) => void;

      handler(mockRequest as FastifyRequest, mockReply);

      expect(log.error).toHaveBeenCalledWith("Failed to serve status.html:", fileError);
      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith("Failed to load status page");
    });
  });

  describe("/css/status.css endpoint", () => {
    it("should serve CSS file", () => {
      const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
      const cssContent = "body { background: white; }";
      mockReadFileSync.mockReturnValue(cssContent);

      statusRouter(mockFastify, routerOptions, jest.fn());

      const routeConfig = mockFastify.get.mock.calls.find((call) => call[0] === "/css/status.css");
      const handler = routeConfig?.[2] as unknown as (req: FastifyRequest, reply: FastifyReply) => void;

      handler(mockRequest as FastifyRequest, mockReply);

      const expectedPath = path.join(process.cwd(), "public", "css", "status.css");
      expect(mockReadFileSync).toHaveBeenCalledWith(expectedPath, "utf-8");
      expect(mockReply.type).toHaveBeenCalledWith("text/css");
      expect(mockReply.send).toHaveBeenCalledWith(cssContent);
    });

    it("should handle CSS file read errors", () => {
      const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
      const fileError = new Error("CSS not found");
      mockReadFileSync.mockImplementation(() => {
        throw fileError;
      });

      statusRouter(mockFastify, routerOptions, jest.fn());

      const routeConfig = mockFastify.get.mock.calls.find((call) => call[0] === "/css/status.css");
      const handler = routeConfig?.[2] as unknown as (req: FastifyRequest, reply: FastifyReply) => void;

      handler(mockRequest as FastifyRequest, mockReply);

      expect(log.error).toHaveBeenCalledWith("Failed to serve status.css:", fileError);
      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith("Failed to load styles");
    });
  });

  describe("/js/status.js endpoint", () => {
    it("should serve JavaScript file", () => {
      const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
      const jsContent = "console.log('Status page');";
      mockReadFileSync.mockReturnValue(jsContent);

      statusRouter(mockFastify, routerOptions, jest.fn());

      const routeConfig = mockFastify.get.mock.calls.find((call) => call[0] === "/js/status.js");
      const handler = routeConfig?.[2] as unknown as (req: FastifyRequest, reply: FastifyReply) => void;

      handler(mockRequest as FastifyRequest, mockReply);

      const expectedPath = path.join(process.cwd(), "public", "js", "status.js");
      expect(mockReadFileSync).toHaveBeenCalledWith(expectedPath, "utf-8");
      expect(mockReply.type).toHaveBeenCalledWith("application/javascript");
      expect(mockReply.send).toHaveBeenCalledWith(jsContent);
    });

    it("should handle JavaScript file read errors", () => {
      const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
      const fileError = new Error("JS not found");
      mockReadFileSync.mockImplementation(() => {
        throw fileError;
      });

      statusRouter(mockFastify, routerOptions, jest.fn());

      const routeConfig = mockFastify.get.mock.calls.find((call) => call[0] === "/js/status.js");
      const handler = routeConfig?.[2] as unknown as (req: FastifyRequest, reply: FastifyReply) => void;

      handler(mockRequest as FastifyRequest, mockReply);

      expect(log.error).toHaveBeenCalledWith("Failed to serve status.js:", fileError);
      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith("Failed to load script");
    });
  });

  describe("edge cases", () => {
    it("should work without fileSystemManager", () => {
      const doneMock = jest.fn();
      routerOptions.fileSystemManager = null;
      statusRouter(mockFastify, routerOptions, doneMock);

      expect(mockFastify.get).toHaveBeenCalledTimes(4);
      expect(doneMock).toHaveBeenCalled();
    });

    it("should work without updateScheduler", () => {
      const doneMock = jest.fn();
      routerOptions.updateScheduler = null;
      statusRouter(mockFastify, routerOptions, doneMock);

      expect(mockFastify.get).toHaveBeenCalledTimes(4);
      expect(doneMock).toHaveBeenCalled();
    });

    it("should work with undefined statusDashboardEnabled", () => {
      const doneMock = jest.fn();
      delete routerOptions.statusDashboardEnabled;
      statusRouter(mockFastify, routerOptions, doneMock);

      expect(mockFastify.get).toHaveBeenCalledTimes(4);
      expect(doneMock).toHaveBeenCalled();
    });
  });
});
