import { Logger } from "pino";
import { statfs } from "fs/promises";
import * as v8 from "v8";
import { UpdateScheduler } from "./updateScheduler.js";
import { FileSystemManager } from "./fileSystemManager.js";
import { ProviderServerOptions } from "../model/server.js";
import { LocalDocumentRepository } from "../repositories/localDocumentRepository.js";
import { OptSourceType } from "../model/cli.js";
import { VersionService } from "./versionService.js";
import { getPackageVersion } from "../util/files.js";

export interface StatusResponse {
  version: string;
  versionInfo: {
    current: string;
    latest: string;
    isOutdated: boolean;
  };
  content?: {
    lastFetchTime: string | null;
    currentVersion: string | null;
    updateStatus: "idle" | "scheduled" | "in_progress" | "failed";
    scheduledUpdateTime?: string | null;
    failedUpdates: number;
    commitHash: string | null;
    failedCommitHash?: string | null;
    lastWebhookTime?: string | null;
    lastError?: string;
  };
  settings?: {
    sourceType: string;
    baseUrl: string;
    directory: string;
    authMethods: string;
    githubUrl?: string;
    githubBranch?: string;
    githubRepository?: string;
    updateDelay?: number;
    serverStartupTime: string;
  };
  systemMetrics?: {
    memory: {
      used: number;
      total: number;
    };
    disk: {
      used: number;
      total: number;
    };
  };
}

export class StatusService {
  private readonly updateScheduler: UpdateScheduler | null;
  private readonly fileSystemManager: FileSystemManager | null;
  private readonly logger: Logger;
  private readonly serverOptions: ProviderServerOptions;
  private readonly localRepository: LocalDocumentRepository | null;
  private readonly version: string;
  private readonly serverStartupTime: Date;

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
  }

  public async getStatus(): Promise<StatusResponse> {
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

    const response: StatusResponse = {
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
        lastError: updateStatus.lastError || undefined,
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

  public async getSystemMetrics(): Promise<{
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
