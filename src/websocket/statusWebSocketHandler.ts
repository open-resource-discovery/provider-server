import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { UpdateScheduler } from "../services/updateScheduler.js";
import { FileSystemManager } from "../services/fileSystemManager.js";
import { Logger } from "pino";
import { getPackageVersion } from "../routes/statusRouter.js";

interface WebSocketMessage {
  type: string;
  data?: unknown;
  error?: string;
  scheduledTime?: string;
}

export class StatusWebSocketHandler {
  private readonly clients: Set<WebSocket> = new Set();
  private readonly updateScheduler: UpdateScheduler | null;
  private readonly fileSystemManager: FileSystemManager | null;
  private readonly logger: Logger;
  private readonly version: string;

  public constructor(
    updateScheduler: UpdateScheduler | null,
    fileSystemManager: FileSystemManager | null,
    logger: Logger,
  ) {
    this.updateScheduler = updateScheduler;
    this.fileSystemManager = fileSystemManager;
    this.logger = logger;
    this.version = getPackageVersion();

    // Subscribe to update events
    if (this.updateScheduler) {
      this.updateScheduler.on("update-started", () => {
        this.broadcast({ type: "update-started" });
      });

      this.updateScheduler.on("update-completed", () => {
        this.broadcast({ type: "update-completed" });
        // Send fresh status after update
        this.broadcastStatus();
      });

      this.updateScheduler.on("update-failed", (error: Error) => {
        this.broadcast({
          type: "update-failed",
          error: error.message || "Update failed",
        });
      });

      this.updateScheduler.on("update-scheduled", (scheduledTime: Date) => {
        this.broadcast({
          type: "update-scheduled",
          scheduledTime: scheduledTime.toISOString(),
        });
      });

      this.updateScheduler.on("update-progress", (progress: unknown) => {
        this.broadcast({
          type: "update-progress",
          data: progress,
        });
      });
    }
  }

  public register(fastify: FastifyInstance): void {
    fastify.get("/ws", { websocket: true }, (socket, _req) => {
      this.handleConnection(socket);
    });
  }

  private handleConnection(socket: WebSocket): void {
    this.logger.info("New WebSocket connection");
    this.clients.add(socket);

    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(socket, message);
      } catch (error) {
        this.logger.error("Failed to parse WebSocket message:", error);
        socket.send(
          JSON.stringify({
            type: "error",
            error: "Invalid message format",
          }),
        );
      }
    });

    socket.on("close", () => {
      this.logger.info("WebSocket connection closed");
      this.clients.delete(socket);
    });

    socket.on("error", (error) => {
      this.logger.error("WebSocket error:", error);
      this.clients.delete(socket);
    });

    // Send initial status
    this.sendStatus(socket);
  }

  private async handleMessage(socket: WebSocket, message: WebSocketMessage): Promise<void> {
    switch (message.type) {
      case "status":
        await this.sendStatus(socket);
        break;
      case "health":
        await this.sendHealth(socket);
        break;
      default:
        socket.send(
          JSON.stringify({
            type: "error",
            error: `Unknown message type: ${message.type}`,
          }),
        );
    }
  }

  private async sendStatus(socket: WebSocket): Promise<void> {
    const status = await this.getStatus();
    socket.send(
      JSON.stringify({
        type: "status",
        data: status,
      }),
    );
  }

  private sendHealth(socket: WebSocket): void {
    const health = {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
    socket.send(
      JSON.stringify({
        type: "health",
        data: health,
      }),
    );
  }

  private async getStatus(): Promise<Record<string, unknown>> {
    const response: Record<string, unknown> = {
      version: this.version,
    };

    if (this.fileSystemManager && this.updateScheduler) {
      const updateStatus = this.updateScheduler.getStatus();
      const currentVersion = await this.fileSystemManager.getCurrentVersion();

      response.content = {
        lastFetchTime: updateStatus.lastUpdateTime?.toISOString() || null,
        currentVersion: currentVersion,
        updateStatus: updateStatus.updateInProgress
          ? "in_progress"
          : updateStatus.scheduledUpdateTime
            ? "scheduled"
            : updateStatus.lastUpdateFailed
              ? "failed"
              : "idle",
        scheduledUpdateTime: updateStatus.scheduledUpdateTime?.toISOString() || null,
        failedUpdates: updateStatus.failedUpdates,
      };
    }

    return response;
  }

  private broadcast(message: WebSocketMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (this.isOpen(client)) {
        client.send(data);
      }
    }
  }

  private async broadcastStatus(): Promise<void> {
    const status = await this.getStatus();
    this.broadcast({
      type: "status",
      data: status,
    });
  }

  private isOpen(ws: WebSocket): boolean {
    // @ts-expect-error WebSocket types may vary
    return ws.readyState === ws.OPEN || ws.readyState === 1;
  }
}
