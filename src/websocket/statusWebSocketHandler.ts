import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { UpdateScheduler } from "../services/updateScheduler.js";
import { FileSystemManager } from "../services/fileSystemManager.js";
import { Logger } from "pino";
import { getPackageVersion } from "../routes/statusRouter.js";
import { ProviderServerOptions } from "../model/server.js";
import { LocalDocumentRepository } from "../repositories/localDocumentRepository.js";
import { OptSourceType } from "../model/cli.js";
import { VersionService } from "../services/versionService.js";
import { statfs } from "fs/promises";
import * as v8 from "v8";
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
    const status = await this.getStatus();
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
            this.getSystemMetrics(),
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

  public async getStatus(): Promise<Record<string, unknown>> {
    const versionService = VersionService.getInstance();
    const versionInfoPromise = versionService.getVersionInfo(this.version);
    const systemMetricsPromise = this.getSystemMetrics();

    let versionInfo;
    try {
      versionInfo = await Promise.race([
        versionInfoPromise,
        new Promise<{ current: string; latest: string; isOutdated: boolean }>((resolve) =>
          setTimeout(() => resolve({ current: this.version, latest: this.version, isOutdated: false }), 2000),
        ),
      ]);
    } catch {
      versionInfo = { current: this.version, latest: this.version, isOutdated: false };
    }

    const response: Record<string, unknown> = {
      version: this.version,
      versionInfo: {
        current: versionInfo.current,
        latest: versionInfo.latest,
        isOutdated: versionInfo.isOutdated,
      },
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
        failedCommitHash: updateStatus.failedCommitHash || null,
        lastWebhookTime: this.updateScheduler.getLastWebhookTime()?.toISOString() || null,
      };
    }

    // Add CLI settings
    let displayDirectory = this.serverOptions.ordDirectory + "/" + this.serverOptions.ordDocumentsSubDirectory;

    // For local mode, show only the last two directory names with .../ prefix
    if (this.serverOptions.sourceType === OptSourceType.Local) {
      const parts = displayDirectory.split("/").filter((part) => part.length > 0);
      if (parts.length > 1) {
        displayDirectory = ".../" + parts[parts.length - 2] + "/" + parts[parts.length - 1];
      } else if (parts.length === 1) {
        displayDirectory = ".../" + parts[0];
      }
    }

    response.settings = {
      sourceType: this.serverOptions.sourceType,
      baseUrl: this.serverOptions.baseUrl || "",
      directory: displayDirectory,
      authMethods: this.serverOptions.authentication.methods.join(", "),
      githubUrl: this.serverOptions.githubApiUrl || "",
      githubBranch: this.serverOptions.githubBranch || "",
      githubRepository: this.serverOptions.githubRepository || "",
      updateDelay: this.serverOptions.updateDelay / 1000, // Convert back to seconds
      serverStartupTime: this.serverStartupTime.toISOString(),
    };

    // Get system metrics with timeout
    try {
      response.systemMetrics = await Promise.race([
        systemMetricsPromise,
        new Promise<{ memory: { used: number; total: number }; disk: { used: number; total: number } }>((resolve) =>
          setTimeout(
            () =>
              resolve({
                memory: { used: 0, total: 0 },
                disk: { used: 0, total: 0 },
              }),
            1000,
          ),
        ),
      ]);
    } catch {
      this.logger.warn("Failed to get system metrics");
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

  private async getSystemMetrics(): Promise<{
    memory: { used: number; total: number };
    disk: { used: number; total: number };
  }> {
    const mem = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();

    // Use V8 heap memory as it's most relevant for Node.js processes
    const usedMemory = mem.heapUsed;
    const totalMemory = heapStats.heap_size_limit;

    try {
      const stats = await statfs("/");
      const totalDisk = stats.blocks * stats.bsize;
      const freeDisk = stats.bavail * stats.bsize;
      const usedDisk = totalDisk - freeDisk;

      return {
        memory: {
          used: usedMemory,
          total: totalMemory,
        },
        disk: {
          used: usedDisk,
          total: totalDisk,
        },
      };
    } catch (error) {
      this.logger.error("Failed to get disk metrics:", error);
      return {
        memory: {
          used: usedMemory,
          total: totalMemory,
        },
        disk: {
          used: 0,
          total: 0,
        },
      };
    }
  }
}
