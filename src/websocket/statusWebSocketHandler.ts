import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { UpdateScheduler } from "../services/updateScheduler.js";
import { FileSystemManager } from "../services/fileSystemManager.js";
import { Logger } from "pino";
import { getPackageVersion } from "../routes/statusRouter.js";
import { ProviderServerOptions } from "../model/server.js";
import { LocalDocumentRepository } from "../repositories/localDocumentRepository.js";
import { OptSourceType } from "../model/cli.js";

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
  private readonly serverOptions: ProviderServerOptions;
  private readonly serverStartupTime: Date;
  private readonly localRepository: LocalDocumentRepository | null;

  public constructor(
    updateScheduler: UpdateScheduler | null,
    fileSystemManager: FileSystemManager | null,
    logger: Logger,
    serverOptions: ProviderServerOptions,
    localRepository: LocalDocumentRepository | null = null,
  ) {
    this.updateScheduler = updateScheduler;
    this.fileSystemManager = fileSystemManager;
    this.logger = logger;
    this.serverOptions = serverOptions;
    this.localRepository = localRepository;
    this.version = getPackageVersion();
    this.serverStartupTime = new Date();

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

    if (this.serverOptions.sourceType === OptSourceType.Local) {
      let currentVersion = "current";

      // Get directory hash for local mode
      if (this.localRepository) {
        const directoryPath = this.serverOptions.ordDocumentsSubDirectory || "";
        const hash = await this.localRepository.getDirectoryHash(directoryPath);
        if (hash) {
          currentVersion = hash.substring(0, 7); // Use first 7 chars like git short hash
        }
      }

      response.content = {
        lastFetchTime: this.serverStartupTime.toISOString(),
        currentVersion: currentVersion,
        updateStatus: "idle",
        scheduledUpdateTime: null,
        failedUpdates: 0,
        commitHash: null,
      };
    } else if (this.fileSystemManager && this.updateScheduler) {
      // GitHub mode needs both fileSystemManager and updateScheduler
      const updateStatus = this.updateScheduler.getStatus();
      const currentVersion = await this.fileSystemManager.getCurrentVersion();
      const metadata = await this.fileSystemManager.getMetadata();

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
        commitHash: metadata?.commitHash || null,
      };
    }

    // Add CLI settings
    response.settings = {
      sourceType: this.serverOptions.sourceType,
      baseUrl: this.serverOptions.baseUrl || "",
      directory: this.serverOptions.ordDirectory + "/" + this.serverOptions.ordDocumentsSubDirectory,
      authMethods: this.serverOptions.authentication.methods.join(", "),
      githubUrl: this.serverOptions.githubApiUrl || "",
      githubBranch: this.serverOptions.githubBranch || "",
      githubRepository: this.serverOptions.githubRepository || "",
      updateDelay: this.serverOptions.updateDelay / 1000, // Convert back to seconds
      serverStartupTime: this.serverStartupTime.toISOString(),
    };

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
