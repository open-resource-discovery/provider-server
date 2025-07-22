import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { Logger } from "pino";
import { StatusService } from "../services/statusService.js";
import { VersionService } from "../services/versionService.js";
import { UpdateScheduler } from "../services/updateScheduler.js";
import { getPackageVersion } from "../util/files.js";

interface WebSocketMessage {
  type: string;
  data?: unknown;
  error?: string;
  scheduledTime?: string;
}

export class StatusWebSocketHandler {
  private readonly clients: Set<WebSocket> = new Set();
  private readonly statusService: StatusService;
  private readonly logger: Logger;
  private readonly version: string;

  public constructor(statusService: StatusService, updateScheduler: UpdateScheduler | null, logger: Logger) {
    this.statusService = statusService;
    this.logger = logger;
    this.version = getPackageVersion();

    // Subscribe to update events
    if (updateScheduler) {
      updateScheduler.on("update-started", () => {
        this.broadcast({ type: "update-started" });
      });

      updateScheduler.on("update-completed", () => {
        this.broadcast({ type: "update-completed" });
        // Send fresh status after update
        this.broadcastStatus();
      });

      updateScheduler.on("update-failed", (error: Error) => {
        this.broadcast({
          type: "update-failed",
          error: error.message || "Update failed",
        });
      });

      updateScheduler.on("update-scheduled", (scheduledTime: Date) => {
        this.broadcast({
          type: "update-scheduled",
          scheduledTime: scheduledTime.toISOString(),
        });
      });

      updateScheduler.on("update-progress", (progress: unknown) => {
        this.broadcast({
          type: "update-progress",
          data: progress,
        });
      });
    }
  }

  public register(fastify: FastifyInstance): void {
    fastify.get("/api/v1/ws", { websocket: true, logLevel: "error" }, (socket, _req) => {
      this.handleConnection(socket);
    });
  }

  private handleConnection(socket: WebSocket): void {
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

    // After initial status, send full update with complete data
    this.sendFullStatusDelayed(socket);
  }

  private async handleMessage(socket: WebSocket, message: WebSocketMessage): Promise<void> {
    switch (message.type) {
      case "status":
        await this.sendStatus(socket);
        break;
      case "health":
        this.sendHealth(socket);
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
    const status = await this.statusService.getStatus();
    socket.send(
      JSON.stringify({
        type: "status",
        data: status,
      }),
    );
  }

  private sendFullStatusDelayed(socket: WebSocket): void {
    // Wait a bit then send full status with complete version info and metrics
    setTimeout(async () => {
      if (this.isOpen(socket)) {
        try {
          const versionService = VersionService.getInstance();
          const [versionInfo, systemMetrics] = await Promise.all([
            versionService.getVersionInfo(this.version),
            this.statusService.getSystemMetrics(),
          ]);

          socket.send(
            JSON.stringify({
              type: "status",
              data: {
                versionInfo: {
                  current: versionInfo.current,
                  latest: versionInfo.latest,
                  isOutdated: versionInfo.isOutdated,
                },
                systemMetrics,
              },
            }),
          );
        } catch (error) {
          this.logger.warn("Failed to send delayed full status:", error);
        }
      }
    }, 100);
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

  private broadcast(message: WebSocketMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (this.isOpen(client)) {
        client.send(data);
      }
    }
  }

  private async broadcastStatus(): Promise<void> {
    const status = await this.statusService.getStatus();
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
