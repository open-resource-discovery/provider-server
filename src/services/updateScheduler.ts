import { EventEmitter } from "events";
import { ContentFetcher, ContentFetchProgress } from "./interfaces/contentFetcher.js";
import { FileSystemManager } from "./fileSystemManager.js";
import { Logger } from "pino";

export interface UpdateSchedulerConfig {
  updateDelay: number; // milliseconds - also used as webhook cooldown
}

export interface UpdateStatus {
  lastUpdateTime: Date | null;
  scheduledUpdateTime: Date | null;
  updateInProgress: boolean;
  failedUpdates: number;
  currentVersion: string | null;
}

export class UpdateScheduler extends EventEmitter {
  private readonly config: UpdateSchedulerConfig;
  private readonly contentFetcher: ContentFetcher;
  private readonly fileSystemManager: FileSystemManager;
  private readonly logger: Logger;

  private updateTimeout: NodeJS.Timeout | null = null;
  private updateInProgress = false;
  private lastUpdateTime: Date | null = null;
  private lastWebhookUpdateTime: Date | null = null;
  private scheduledUpdateTime: Date | null = null;
  private failedUpdates = 0;
  private webhookCooldownTimeout: NodeJS.Timeout | null = null;

  public constructor(
    config: UpdateSchedulerConfig,
    contentFetcher: ContentFetcher,
    fileSystemManager: FileSystemManager,
    logger: Logger,
  ) {
    super();
    this.config = config;
    this.contentFetcher = contentFetcher;
    this.fileSystemManager = fileSystemManager;
    this.logger = logger;
  }

  public async initialize(): Promise<void> {
    // Load last update time from metadata
    const metadata = await this.fileSystemManager.getMetadata();
    if (metadata) {
      this.lastUpdateTime = metadata.fetchTime;
      this.logger.info(`Loaded last update time from metadata: ${this.lastUpdateTime.toISOString()}`);
    }
  }

  public scheduleUpdate(delay?: number): void {
    const effectiveDelay = delay ?? this.config.updateDelay;

    // Cancel any existing scheduled update
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
    }

    // Abort any running update
    if (this.updateInProgress) {
      this.logger.info("Aborting current update to schedule new one");
      this.contentFetcher.abortFetch();
    }

    this.scheduledUpdateTime = new Date(Date.now() + effectiveDelay);
    this.logger.info(`Update scheduled for ${this.scheduledUpdateTime.toISOString()}`);

    this.updateTimeout = setTimeout(() => {
      this.performUpdate().catch((error) => {
        this.logger.error("Update failed: %s", error);
        this.failedUpdates++;
        this.emit("update-failed", error);
      });
    }, effectiveDelay);

    this.emit("update-scheduled", this.scheduledUpdateTime);
  }

  public async forceUpdate(): Promise<void> {
    if (this.updateInProgress) {
      throw new Error("Update already in progress");
    }

    // Cancel scheduled update
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
      this.scheduledUpdateTime = null;
    }

    await this.performUpdate();
  }

  public async scheduleImmediateUpdate(): Promise<void> {
    if (this.webhookCooldownTimeout) {
      clearTimeout(this.webhookCooldownTimeout);
      this.webhookCooldownTimeout = null;
    }

    // Check webhook cooldown
    if (this.lastWebhookUpdateTime) {
      const timeSinceLastWebhook = Date.now() - this.lastWebhookUpdateTime.getTime();
      if (timeSinceLastWebhook < this.config.updateDelay) {
        const remainingTime = this.config.updateDelay - timeSinceLastWebhook;
        this.logger.info(
          `Webhook update throttled. Will process latest request in ${Math.ceil(remainingTime / 1000)}s`,
        );

        // Schedule to process the latest webhook after cooldown
        this.webhookCooldownTimeout = setTimeout(() => {
          this.webhookCooldownTimeout = null;
          this.scheduleImmediateUpdate().catch((error) => {
            this.logger.error("Webhook update after cooldown failed:", error);
          });
        }, remainingTime);
        return;
      }
    }

    // If update is already in progress, abort it to process the latest webhook
    if (this.updateInProgress) {
      this.logger.info("Aborting current update to process latest webhook request");
      this.contentFetcher.abortFetch();
      // Wait a bit for the abort to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Cancel any scheduled update
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
      this.scheduledUpdateTime = null;
    }

    this.lastWebhookUpdateTime = new Date();
    this.logger.info("Starting immediate webhook-triggered update");

    try {
      await this.performUpdate();
    } catch (error) {
      this.logger.error("Webhook update failed:", error);
      this.emit("update-failed", error);
      throw error;
    }
  }

  private async performUpdate(): Promise<void> {
    if (this.updateInProgress) {
      return;
    }

    this.updateInProgress = true;
    this.scheduledUpdateTime = null;
    this.emit("update-started");

    const tempDir = await this.fileSystemManager.getTempDirectory();

    try {
      this.logger.info("Starting content update");

      const currentVersion = await this.fileSystemManager.getCurrentVersion();
      this.logger.debug(`  Current version: ${currentVersion || "none"}`);

      const metadata = await this.contentFetcher.fetchAllContent(tempDir, (progress: ContentFetchProgress) => {
        this.emit("update-progress", progress);
      });

      // Validate the new content
      const isValid = await this.fileSystemManager.validateContent(tempDir);
      if (!isValid) {
        throw new Error("Content validation failed");
      }

      await this.fileSystemManager.swapDirectories(tempDir);

      // Save metadata
      await this.fileSystemManager.saveMetadata(metadata);

      this.lastUpdateTime = metadata.fetchTime;
      this.failedUpdates = 0;

      this.logger.info(`Successfully updated content to commit ${metadata.commitHash}`);
      this.emit("update-completed");
    } catch (error) {
      this.logger.error(`Update failed: ${error}`);
      this.failedUpdates++;

      // Cleanup failed update
      try {
        await this.fileSystemManager.cleanupTempDirectory();
      } catch (cleanupError) {
        this.logger.error("Failed to cleanup temp directory:", cleanupError);
      }

      throw error;
    } finally {
      this.updateInProgress = false;
    }
  }

  public getStatus(): UpdateStatus {
    return {
      lastUpdateTime: this.lastUpdateTime,
      scheduledUpdateTime: this.scheduledUpdateTime,
      updateInProgress: this.updateInProgress,
      failedUpdates: this.failedUpdates,
      currentVersion: null, // Will be set by fileSystemManager
    };
  }

  public isUpdateScheduled(): boolean {
    return this.scheduledUpdateTime !== null;
  }

  public isUpdateInProgress(): boolean {
    return this.updateInProgress;
  }

  public getLastUpdateTime(): Date | null {
    return this.lastUpdateTime;
  }

  public async checkForUpdates(): Promise<boolean> {
    try {
      const metadata = await this.fileSystemManager.getMetadata();
      if (!metadata) {
        this.logger.info("No metadata found, update needed");
        return true;
      }

      // Get latest commit SHA from GitHub
      const latestSha = await this.contentFetcher.getLatestCommitSha();

      const needsUpdate = metadata.commitHash !== latestSha;

      if (needsUpdate) {
        this.logger.info(`SHA mismatch detected. Current: ${metadata.commitHash}, Latest: ${latestSha}`);
      } else {
        this.logger.debug(`SHA match confirmed: ${latestSha}`);
      }

      return needsUpdate;
    } catch (error) {
      this.logger.error(`Failed to check for updates: ${error}`);
      return false;
    }
  }
}
