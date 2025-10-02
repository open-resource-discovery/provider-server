import { EventEmitter } from "events";
import { ContentFetchProgress } from "./interfaces/contentFetcher.js";
import { Logger } from "pino";
import { log as defaultLogger } from "../util/logger.js";

export type UpdateStatus = "idle" | "in_progress" | "scheduled" | "failed";
export type UpdateSource = "validation" | "scheduler" | "webhook" | "manual";

export interface UpdateState {
  status: UpdateStatus;
  source?: UpdateSource;
  phase?: string;
  progress?: ContentFetchProgress;
  lastUpdateTime?: Date;
  scheduledTime?: Date;
  lastError?: string;
  failedCommitHash?: string;
  updateInProgress: boolean;
  failedUpdates: number;
}

export interface UpdateStateChangeEvent {
  type: "state-changed";
  previousState: UpdateState;
  currentState: UpdateState;
}

/**
 * Centralized manager for tracking update state across the application.
 * Provides a single source of truth for update status.
 */
export class UpdateStateManager extends EventEmitter {
  private state: UpdateState = {
    status: "idle",
    updateInProgress: false,
    failedUpdates: 0,
  };

  private readonly logger: Logger;

  public constructor(logger: Logger = defaultLogger) {
    super();
    this.logger = logger;
  }

  public getState(): UpdateState {
    return { ...this.state };
  }

  /**
   * Update the state with partial updates
   */
  public setState(updates: Partial<UpdateState>): void {
    const previousState = { ...this.state };
    this.state = { ...this.state, ...updates };

    this.logger.debug(`Update state changed from ${previousState.status} to ${this.state.status}`);

    // Emit state change event
    this.emit("state-changed", {
      type: "state-changed",
      previousState,
      currentState: { ...this.state },
    });

    // Also emit specific events for backward compatibility
    if (updates.status) {
      switch (updates.status) {
        case "in_progress":
          this.emit("update-started");
          break;
        case "idle":
          if (previousState.status === "in_progress") {
            this.emit("update-completed");
          }
          break;
        case "failed":
          this.emit("update-failed", this.state.lastError);
          break;
        case "scheduled":
          this.emit("update-scheduled", this.state.scheduledTime);
          break;
      }
    }

    // Emit progress updates
    if (updates.progress) {
      this.emit("update-progress", updates.progress);
    }
  }

  /**
   * Start an update operation
   */
  public startUpdate(source: UpdateSource): void {
    this.logger.info(`Starting update from source: ${source}`);
    this.setState({
      status: "in_progress",
      source,
      updateInProgress: true,
      phase: undefined,
      progress: undefined,
      lastError: undefined,
    });
  }

  /**
   * Mark update as completed successfully
   */
  public completeUpdate(): void {
    this.logger.info("Update completed successfully");
    this.setState({
      status: "idle",
      updateInProgress: false,
      lastUpdateTime: new Date(),
      failedUpdates: 0,
      lastError: undefined,
      failedCommitHash: undefined,
      phase: undefined,
      progress: undefined,
    });
  }

  /**
   * Mark update as failed
   */
  public failUpdate(error: string, failedCommitHash?: string): void {
    this.logger.debug(`Update state changed to failed: ${error}`);
    this.setState({
      status: "failed",
      updateInProgress: false,
      lastError: error,
      failedCommitHash,
      failedUpdates: this.state.failedUpdates + 1,
      phase: undefined,
      progress: undefined,
    });
  }

  /**
   * Schedule an update
   */
  public scheduleUpdate(scheduledTime: Date): void {
    this.logger.info(`Update scheduled for ${scheduledTime.toISOString()}`);
    this.setState({
      status: "scheduled",
      scheduledTime,
      updateInProgress: false,
    });
  }

  /**
   * Update progress information
   */
  public setProgress(progress: ContentFetchProgress, phase?: string): void {
    this.setState({
      progress,
      phase: phase || progress.phase,
    });
  }

  /**
   * Reset state to idle
   */
  public reset(): void {
    this.setState({
      status: "idle",
      updateInProgress: false,
      source: undefined,
      phase: undefined,
      progress: undefined,
      scheduledTime: undefined,
    });
  }

  public isUpdateInProgress(): boolean {
    return this.state.updateInProgress;
  }

  public getLastUpdateTime(): Date | undefined {
    return this.state.lastUpdateTime;
  }

  public getUpdateSource(): UpdateSource | undefined {
    return this.state.source;
  }

  /**
   * Wait for any in-progress update to complete before proceeding
   * This allows requests to queue and wait during git operations
   *
   * @param timeoutMs Maximum time to wait in milliseconds (default: 5 minutes)
   * @returns Promise that resolves when ready or rejects on timeout
   */
  public waitForReady(timeoutMs: number = 5 * 60 * 1000): Promise<void> {
    // If no update in progress, resolve immediately
    if (!this.state.updateInProgress) {
      return Promise.resolve();
    }

    this.logger.debug("Request waiting for update to complete...");

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const errorMsg = `Timeout waiting for update to complete (${timeoutMs}ms)`;
        this.logger.warn(errorMsg);
        reject(new Error(errorMsg));
      }, timeoutMs);

      const onCompleted = (): void => {
        this.logger.debug("Update completed, request proceeding");
        resolve();
      };

      const onFailed = (): void => {
        this.logger.warn("Update failed, but allowing request to proceed with existing content");
        // Still resolve - we want to try serving with whatever content exists
        resolve();
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        this.off("update-completed", onCompleted);
        this.off("update-failed", onFailed);
      };

      this.once("update-completed", onCompleted);
      this.once("update-failed", onFailed);

      // Double-check status in case it changed between initial check and listener setup
      if (!this.state.updateInProgress) {
        cleanup();
        resolve();
      }
    });
  }
}
