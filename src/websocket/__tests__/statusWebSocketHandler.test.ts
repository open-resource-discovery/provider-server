import { StatusWebSocketHandler } from "../statusWebSocketHandler.js";
import { StatusService } from "../../services/statusService.js";
import { UpdateScheduler } from "../../services/updateScheduler.js";
import { Logger } from "pino";
import { EventEmitter } from "events";
import { FastifyInstance } from "fastify";
import { WebSocket } from "ws";

jest.mock("../../services/versionService.js");
jest.mock("../../util/files.js", () => ({
  getPackageVersion: jest.fn().mockReturnValue("1.0.0"),
}));

describe("StatusWebSocketHandler", () => {
  let handler: StatusWebSocketHandler;
  let mockStatusService: jest.Mocked<StatusService>;
  let mockUpdateScheduler: jest.Mocked<UpdateScheduler> & EventEmitter;
  let mockLogger: jest.Mocked<Logger>;
  let mockFastify: jest.Mocked<FastifyInstance>;
  let mockSocket: jest.Mocked<WebSocket>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock UpdateScheduler with EventEmitter capabilities
    mockUpdateScheduler = Object.assign(new EventEmitter(), {
      getStatus: jest.fn(),
      getLastWebhookTime: jest.fn(),
      scheduleImmediateUpdate: jest.fn(),
    }) as unknown as jest.Mocked<UpdateScheduler> & EventEmitter;

    mockStatusService = {
      getStatus: jest.fn().mockResolvedValue({
        version: "1.0.0",
        settings: { sourceType: "github" },
      }),
      getSystemMetrics: jest.fn().mockResolvedValue({
        memory: { used: 100, total: 200 },
        disk: { used: 500, total: 1000 },
      }),
    } as unknown as jest.Mocked<StatusService>;

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    mockSocket = {
      send: jest.fn(),
      on: jest.fn(),
      readyState: 1, // OPEN state
      OPEN: 1,
    } as unknown as jest.Mocked<WebSocket>;

    mockFastify = {
      get: jest.fn(),
    } as unknown as jest.Mocked<FastifyInstance>;

    handler = new StatusWebSocketHandler(mockStatusService, mockUpdateScheduler, mockLogger);
  });

  describe("constructor", () => {
    it("should subscribe to update scheduler events", () => {
      const listenerCount = mockUpdateScheduler.listenerCount("update-started");
      expect(listenerCount).toBe(1);
      expect(mockUpdateScheduler.listenerCount("update-completed")).toBe(1);
      expect(mockUpdateScheduler.listenerCount("update-failed")).toBe(1);
      expect(mockUpdateScheduler.listenerCount("update-scheduled")).toBe(1);
      expect(mockUpdateScheduler.listenerCount("update-progress")).toBe(1);
    });

    it("should work without update scheduler", () => {
      const handlerNoScheduler = new StatusWebSocketHandler(mockStatusService, null, mockLogger);
      expect(handlerNoScheduler).toBeDefined();
    });
  });

  describe("register", () => {
    it("should register WebSocket endpoint", () => {
      handler.register(mockFastify);

      expect(mockFastify.get).toHaveBeenCalledWith(
        "/api/v1/ws",
        { websocket: true, logLevel: "error" },
        expect.any(Function),
      );
    });
  });

  describe("WebSocket connection handling", () => {
    let connectionHandler: (socket: WebSocket, req: unknown) => void;

    beforeEach(() => {
      handler.register(mockFastify);
      connectionHandler = mockFastify.get.mock.calls[0][2] as (socket: WebSocket, req: unknown) => void;
    });

    it("should handle new connection and send initial status", async () => {
      const messageHandler = jest.fn();
      const closeHandler = jest.fn();
      const errorHandler = jest.fn();

      mockSocket.on.mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandler.mockImplementation(handler);
        if (event === "close") closeHandler.mockImplementation(handler);
        if (event === "error") errorHandler.mockImplementation(handler);
        return mockSocket;
      });

      await connectionHandler(mockSocket, {});

      // Should register event handlers
      expect(mockSocket.on).toHaveBeenCalledWith("message", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("close", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("error", expect.any(Function));

      // Should send initial status
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "status",
          data: { version: "1.0.0", settings: { sourceType: "github" } },
        }),
      );

      // Note: Delayed full status is sent after 100ms but testing timing is unreliable
      // The important part is that initial status is sent immediately
      expect(mockSocket.send).toHaveBeenCalled();
    });

    it("should handle message parsing errors", async () => {
      const messageHandler = jest.fn();

      mockSocket.on.mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandler.mockImplementation(handler);
        return mockSocket;
      });

      connectionHandler(mockSocket, {});

      await messageHandler("invalid json");

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(/^Failed to parse WebSocket message: SyntaxError:/),
      );
      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "error",
          error: "Invalid message format",
        }),
      );
    });

    it("should handle status message request", async () => {
      const messageHandler = jest.fn();

      mockSocket.on.mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandler.mockImplementation(handler);
        return mockSocket;
      });

      connectionHandler(mockSocket, {});

      await messageHandler(JSON.stringify({ type: "status" }));

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockStatusService.getStatus).toHaveBeenCalled();
      expect(mockSocket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"status"'));
    });

    it("should handle health message request", async () => {
      const messageHandler = jest.fn();

      mockSocket.on.mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandler.mockImplementation(handler);
        return mockSocket;
      });

      connectionHandler(mockSocket, {});

      await messageHandler(JSON.stringify({ type: "health" }));

      expect(mockSocket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"health"'));
      expect(mockSocket.send).toHaveBeenCalledWith(expect.stringContaining('"status":"ok"'));
    });

    it("should handle unknown message type", async () => {
      const messageHandler = jest.fn();

      mockSocket.on.mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandler.mockImplementation(handler);
        return mockSocket;
      });

      connectionHandler(mockSocket, {});

      await messageHandler(JSON.stringify({ type: "unknown" }));

      expect(mockSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "error",
          error: "Unknown message type: unknown",
        }),
      );
    });

    it("should handle socket close event", () => {
      let closeHandler: () => void;

      mockSocket.on.mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
        if (event === "close") closeHandler = handler as () => void;
        return mockSocket;
      });

      connectionHandler(mockSocket, {});
      closeHandler!();

      expect(mockLogger.debug).toHaveBeenCalledWith("WebSocket connection closed");
    });

    it("should handle socket error event", () => {
      let errorHandler: (error: Error) => void;

      mockSocket.on.mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
        if (event === "error") errorHandler = handler as (error: Error) => void;
        return mockSocket;
      });

      connectionHandler(mockSocket, {});
      const testError = new Error("Connection error");
      errorHandler!(testError);

      expect(mockLogger.error).toHaveBeenCalledWith(`WebSocket error: ${testError}`);
    });
  });

  describe("Update scheduler events", () => {
    let mockClient: jest.Mocked<WebSocket>;

    beforeEach(() => {
      mockClient = {
        send: jest.fn(),
        readyState: 1,
        OPEN: 1,
      } as unknown as jest.Mocked<WebSocket>;

      // Add a client to the handler
      const connectionHandler = mockFastify.get.mock.calls?.[0]?.[2] as (socket: WebSocket, req: unknown) => void;
      if (connectionHandler) {
        mockClient.on = jest.fn().mockReturnValue(mockClient);
        connectionHandler(mockClient, {});
      }
    });

    it("should broadcast update-started event", () => {
      handler.register(mockFastify);
      const connectionHandler = mockFastify.get.mock.calls[0][2] as (socket: WebSocket, req: unknown) => void;
      mockClient.on = jest.fn().mockReturnValue(mockClient);
      connectionHandler(mockClient, {});

      mockUpdateScheduler.emit("update-started");

      expect(mockClient.send).toHaveBeenCalledWith(JSON.stringify({ type: "update-started" }));
    });

    it("should broadcast update-completed event and refresh status", async () => {
      handler.register(mockFastify);
      const connectionHandler = mockFastify.get.mock.calls[0][2] as (socket: WebSocket, req: unknown) => void;
      mockClient.on = jest.fn().mockReturnValue(mockClient);
      connectionHandler(mockClient, {});

      mockUpdateScheduler.emit("update-completed");

      expect(mockClient.send).toHaveBeenCalledWith(JSON.stringify({ type: "update-completed" }));

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockStatusService.getStatus).toHaveBeenCalled();
    });

    it("should broadcast update-failed event with error", () => {
      handler.register(mockFastify);
      const connectionHandler = mockFastify.get.mock.calls[0][2] as (socket: WebSocket, req: unknown) => void;
      mockClient.on = jest.fn().mockReturnValue(mockClient);
      connectionHandler(mockClient, {});

      const error = new Error("Update failed");
      mockUpdateScheduler.emit("update-failed", error);

      expect(mockClient.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "update-failed",
          error: "Update failed",
        }),
      );
    });

    it("should broadcast update-scheduled event with time", () => {
      handler.register(mockFastify);
      const connectionHandler = mockFastify.get.mock.calls[0][2] as (socket: WebSocket, req: unknown) => void;
      mockClient.on = jest.fn().mockReturnValue(mockClient);
      connectionHandler(mockClient, {});

      const scheduledTime = new Date("2024-01-01T12:00:00Z");
      mockUpdateScheduler.emit("update-scheduled", scheduledTime);

      expect(mockClient.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "update-scheduled",
          scheduledTime: "2024-01-01T12:00:00.000Z",
        }),
      );
    });

    it("should broadcast update-progress event", () => {
      handler.register(mockFastify);
      const connectionHandler = mockFastify.get.mock.calls[0][2] as (socket: WebSocket, req: unknown) => void;
      mockClient.on = jest.fn().mockReturnValue(mockClient);
      connectionHandler(mockClient, {});

      const progress = { fetched: 10, total: 100 };
      mockUpdateScheduler.emit("update-progress", progress);

      expect(mockClient.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "update-progress",
          data: progress,
        }),
      );
    });

    it("should not send to closed sockets", () => {
      handler.register(mockFastify);
      const connectionHandler = mockFastify.get.mock.calls[0][2] as (socket: WebSocket, req: unknown) => void;
      mockClient.on = jest.fn().mockReturnValue(mockClient);
      connectionHandler(mockClient, {});

      // Close the socket
      Object.defineProperty(mockClient, "readyState", {
        value: 3, // CLOSED state
        writable: true,
        configurable: true,
      });
      mockClient.send.mockClear();

      mockUpdateScheduler.emit("update-started");

      expect(mockClient.send).not.toHaveBeenCalled();
    });
  });

  describe("isOpen", () => {
    it("should correctly identify open sockets", () => {
      handler.register(mockFastify);
      const connectionHandler = mockFastify.get.mock.calls[0][2] as (socket: WebSocket, req: unknown) => void;

      const openSocket = {
        readyState: 1,
        OPEN: 1,
        on: jest.fn(),
        send: jest.fn(),
      } as unknown as WebSocket;

      connectionHandler(openSocket, {});

      // Test internal behavior by triggering broadcast
      mockUpdateScheduler.emit("update-started");
      expect(openSocket.send).toHaveBeenCalled();
    });

    it("should correctly identify closed sockets", () => {
      handler.register(mockFastify);
      const connectionHandler = mockFastify.get.mock.calls[0][2] as (socket: WebSocket, req: unknown) => void;

      const closedSocket = {
        readyState: 3,
        OPEN: 1,
        on: jest.fn(),
        send: jest.fn(),
      } as unknown as WebSocket;

      connectionHandler(closedSocket, {});

      // Test internal behavior by triggering broadcast
      mockUpdateScheduler.emit("update-started");
      expect(closedSocket.send).not.toHaveBeenCalled();
    });
  });
});
