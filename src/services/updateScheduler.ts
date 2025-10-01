import { EventEmitter } from "events";
import { ContentFetcher } from "./interfaces/contentFetcher.js";
import { FileSystemManager } from "./fileSystemManager.js";
import { Logger } from "pino";
import { DiskSpaceError, MemoryError } from "../model/error/SystemErrors.js";
import { GitHubNetworkError } from "../model/error/GithubErrors.js";
import { createProgressHandler } from "../util/progressHandler.js";
import { UpdateStateManager } from "./updateStateManager.js";

export interface UpdateSchedulerConfig {
  updateDelay: number; // milliseconds - also used as webhook cooldown
}

export interface UpdateStatus {
  lastUpdateTime: Date | null;
  scheduledUpdateTime: Date | null;
  updateInProgress: boolean;
  failedUpdates: number;
  currentVersion: string | null;
  lastUpdateFailed: boolean;
  failedCommitHash: string | null;
  lastError: string | null;
}

export class UpdateScheduler extends EventEmitter {
  private readonly config: UpdateSchedulerConfig;
  private readonly contentFetcher: ContentFetcher;
  private readonly fileSystemManager: FileSystemManager;
  private readonly logger: Logger;
  private readonly stateManager: UpdateStateManager;

  private updateTimeout: NodeJS.Timeout | null = null;
  private updateInProgress = false;
  private lastUpdateTime: Date | null = null;
  private lastWebhookUpdateTime: Date | null = null;
  private scheduledUpdateTime: Date | null = null;
  private failedUpdates = 0;
  private webhookCooldownTimeout: NodeJS.Timeout | null = null;
  private lastUpdateFailed = false;
  private failedCommitHash: string | null = null;
  private periodicCheckInterval: NodeJS.Timeout | null = null;
  private lastError: string | null = null;
  private readonly PERIODIC_CHECK_INTERVAL = 2 * 60 * 60 * 1000;

  public constructor(
    config: UpdateSchedulerConfig,
    contentFetcher: ContentFetcher,
    fileSystemManager: FileSystemManager,
    logger: Logger,
    stateManager: UpdateStateManager,
  ) {
    super();
    this.config = config;
    this.contentFetcher = contentFetcher;
    this.fileSystemManager = fileSystemManager;
    this.logger = logger;
    this.stateManager = stateManager;
  }

  public async initialize(): Promise<void> {
    // Load last update time from metadata
    const metadata = await this.fileSystemManager.getMetadata();
    if (metadata) {
      this.lastUpdateTime = metadata.fetchTime;
      this.logger.info(`Loaded last update time from metadata: ${this.lastUpdateTime.toISOString()}`);
    }

    this.startPeriodicCheck();
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

    // Update state manager
    this.stateManager.scheduleUpdate(this.scheduledUpdateTime);

    this.updateTimeout = setTimeout(() => {
      this.performUpdate().catch((error) => {
        this.logger.error("Update failed: %s", error);
        this.failedUpdates++;
        this.stateManager.failUpdate(error instanceof Error ? error.message : String(error));
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

  public async scheduleImmediateUpdate(isManualTrigger: boolean = false): Promise<void> {
    if (this.webhookCooldownTimeout) {
      clearTimeout(this.webhookCooldownTimeout);
      this.webhookCooldownTimeout = null;
    }

    // Check webhook cooldown (only for actual webhooks, not manual triggers)
    if (!isManualTrigger && this.lastWebhookUpdateTime) {
      const timeSinceLastWebhook = Date.now() - this.lastWebhookUpdateTime.getTime();
      if (timeSinceLastWebhook < this.config.updateDelay) {
        const remainingTime = this.config.updateDelay - timeSinceLastWebhook;
        this.logger.info(
          `Webhook update throttled. Will process latest request in ${Math.ceil(remainingTime / 1000)}s`,
        );

        // Schedule to process the latest webhook after cooldown
        this.webhookCooldownTimeout = setTimeout(() => {
          this.webhookCooldownTimeout = null;
          this.scheduleImmediateUpdate(false).catch((error) => {
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

    // Only update webhook time for actual webhooks, not manual triggers
    if (!isManualTrigger) {
      this.lastWebhookUpdateTime = new Date();
      this.logger.info("Starting immediate webhook-triggered update");
    } else {
      this.logger.info("Starting immediate manual-triggered update");
    }

    try {
      await this.performUpdate();
    } catch (error) {
      this.logger.error(`${isManualTrigger ? "Manual" : "Webhook"} update failed: ${error}`);
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
    this.stateManager.startUpdate("scheduler");
    this.emit("update-started");

    const tempDir = await this.fileSystemManager.prepareTempDirectoryWithGit();

    try {
      this.logger.info("Starting content update");

      const currentVersion = await this.fileSystemManager.getCurrentVersion();
      this.logger.debug(`  Current version: ${currentVersion || "none"}`);

      const progressHandler = createProgressHandler({
        logger: this.logger,
        emitter: this.stateManager,
        emitEvent: "update-progress",
      });
      const metadata = await this.contentFetcher.fetchAllContent(tempDir, progressHandler);

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
      this.lastUpdateFailed = false;
      this.failedCommitHash = null;
      this.lastError = null;

      this.logger.info(`Successfully updated content to commit ${metadata.commitHash}`);
      this.stateManager.completeUpdate();
      this.emit("update-completed");
    } catch (error) {
      this.logger.error(`Update failed: ${error}`);
      this.failedUpdates++;
      this.lastUpdateFailed = true;

      // Check for specific error types and set user-friendly messages
      if (error instanceof DiskSpaceError) {
        this.lastError = "No disk space available";
      } else if (error instanceof MemoryError) {
        this.lastError = "Insufficient memory available";
      } else if (error instanceof GitHubNetworkError) {
        this.lastError = "Unable to connect to GitHub. Please check your network connection and GitHub API settings.";
      } else {
        // For other errors, don't expose the internal error message
        this.lastError = null;
      }

      // Try to get the commit hash that failed
      try {
        const latestSha = await this.contentFetcher.getLatestCommitSha();
        this.failedCommitHash = latestSha;
      } catch {
        // If we can't get the SHA, leave it as null
      }

      // Cleanup failed update
      try {
        await this.fileSystemManager.cleanupTempDirectory();
      } catch (cleanupError) {
        this.logger.error(`Failed to cleanup temp directory: ${cleanupError}`);
      }

      // Update state manager with failure
      let errorMessage: string;
      if (error instanceof DiskSpaceError) {
        errorMessage = "No disk space available";
      } else if (error instanceof MemoryError) {
        errorMessage = "Insufficient memory available";
      } else if (error instanceof GitHubNetworkError) {
        errorMessage = "Unable to connect to GitHub. Please check your network connection and GitHub API settings.";
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = String(error);
      }
      this.stateManager.failUpdate(errorMessage, this.failedCommitHash || undefined);
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
      lastUpdateFailed: this.lastUpdateFailed,
      failedCommitHash: this.failedCommitHash,
      lastError: this.lastError,
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

  // Methods to track external update operations (e.g., initial validation)
  public notifyUpdateStarted(): void {
    this.updateInProgress = true;
    this.stateManager.startUpdate("validation");
    this.emit("update-started");
  }

  public notifyUpdateCompleted(): void {
    this.updateInProgress = false;
    this.lastUpdateTime = new Date();
    this.lastUpdateFailed = false;
    this.failedUpdates = 0;
    this.lastError = null;
    this.stateManager.completeUpdate();
    this.emit("update-completed");
  }

  public notifyUpdateFailed(error: unknown): void {
    this.updateInProgress = false;
    this.lastUpdateFailed = true;
    this.failedUpdates++;
    this.lastError = error instanceof Error ? error.message : String(error);
    this.stateManager.failUpdate(this.lastError);
    this.emit("update-failed", error);
  }

  public async checkForUpdates(): Promise<boolean | undefined> {
    try {
      const metadata = await this.fileSystemManager.getMetadata();
      if (!metadata) {
        this.logger.info("No metadata found, update needed");
        return true;
      }

      const latestDirectorySha = await this.contentFetcher.getDirectoryTreeSha();

      if (latestDirectorySha) {
        // If metadata doesn't have directoryTreeSha, it's from before we added this field
        // so we should update
        if (!metadata.directoryTreeSha) {
          this.logger.info("Metadata missing directoryTreeSha, update needed");
          return true;
        }

        const needsUpdate = metadata.directoryTreeSha !== latestDirectorySha;

        if (needsUpdate) {
          this.logger.debug(
            `Directory SHA mismatch detected. Current: ${metadata.directoryTreeSha}, Latest: ${latestDirectorySha}`,
          );
        } else {
          this.logger.debug(`Directory SHA match confirmed: ${latestDirectorySha}`);
        }

        return needsUpdate;
      }
    } catch (error) {
      this.logger.error(`Failed to check for updates: ${error}`);
      return false;
    }
  }

  public getLastWebhookTime(): Date | null {
    return this.lastWebhookUpdateTime;
  }

  private startPeriodicCheck(): void {
    if (this.periodicCheckInterval) {
      clearInterval(this.periodicCheckInterval);
    }

    this.periodicCheckInterval = setInterval(() => {
      this.checkForContentChanges();
    }, this.PERIODIC_CHECK_INTERVAL);

    this.logger.info("Started periodic content checking (every 2 hours)");
  }

  private async checkForContentChanges(): Promise<void> {
    if (this.updateInProgress) {
      this.logger.debug("Skipping periodic check - update already in progress");
      return;
    }

    try {
      this.logger.info("Performing periodic content check");

      const hasChanged = await this.checkForUpdates();

      if (hasChanged) {
        this.logger.info("Content has changed, scheduling update");
        this.scheduleUpdate(0);
      } else {
        this.logger.debug("No content changes detected");
      }
    } catch (error) {
      this.logger.error("Error during periodic content check: %s", error);
    }
  }

  public stop(): void {
    // Clear all timeouts and intervals
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
    }

    if (this.webhookCooldownTimeout) {
      clearTimeout(this.webhookCooldownTimeout);
      this.webhookCooldownTimeout = null;
    }

    if (this.periodicCheckInterval) {
      clearInterval(this.periodicCheckInterval);
      this.periodicCheckInterval = null;
    }

    // Clean up the content fetcher if it has a destroy method
    if ("destroy" in this.contentFetcher && typeof this.contentFetcher.destroy === "function") {
      this.contentFetcher.destroy();
    }
  }
}
