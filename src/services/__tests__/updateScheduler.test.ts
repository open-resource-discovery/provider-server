import { UpdateScheduler } from "../updateScheduler.js";
import { ContentFetcher, ContentFetchProgress, ContentMetadata } from "../interfaces/contentFetcher.js";
import { FileSystemManager } from "../fileSystemManager.js";
import { Logger } from "pino";

// Mock implementations
class MockContentFetcher implements ContentFetcher {
  public fetchAllContentCalled = false;
  public fetchLatestChangesCalled = false;
  public abortFetchCalled = false;
  public shouldFail = false;

  public async fetchAllContent(
    _targetDir: string,
    onProgress?: (progress: ContentFetchProgress) => void,
  ): Promise<ContentMetadata> {
    this.fetchAllContentCalled = true;
    if (this.shouldFail) {
      throw new Error("Fetch failed");
    }
    if (onProgress) {
      onProgress({
        totalFiles: 10,
        fetchedFiles: 10,
        startTime: new Date(),
        errors: [],
      });
    }
    return await {
      commitHash: "abc123def456",
      fetchTime: new Date(),
      branch: "main",
      repository: "owner/repo",
      totalFiles: 10,
    };
  }

  public async fetchLatestChanges(_targetDir: string, _since?: Date): Promise<ContentMetadata> {
    this.fetchLatestChangesCalled = true;
    return await {
      commitHash: "abc123def456",
      fetchTime: new Date(),
      branch: "main",
      repository: "owner/repo",
      totalFiles: 10,
    };
  }

  public abortFetch(): void {
    this.abortFetchCalled = true;
  }
}

class MockFileSystemManager {
  public getTempDirectoryCalled = false;
  public validateContentCalled = false;
  public swapDirectoriesCalled = false;
  public cleanupTempDirectoryCalled = false;
  public saveMetadataCalled = false;
  public getMetadataCalled = false;
  public shouldValidateFail = false;
  private savedMetadata: ContentMetadata | null = null;

  public async getTempDirectory(): Promise<string> {
    this.getTempDirectoryCalled = true;
    return "/tmp/test";
  }

  public async validateContent(_directory: string): Promise<boolean> {
    this.validateContentCalled = true;
    return !this.shouldValidateFail;
  }

  public async swapDirectories(_tempDir: string): Promise<void> {
    this.swapDirectoriesCalled = true;
  }

  public async cleanupTempDirectory(): Promise<void> {
    this.cleanupTempDirectoryCalled = true;
  }

  public async saveMetadata(metadata: ContentMetadata): Promise<void> {
    this.saveMetadataCalled = true;
    this.savedMetadata = metadata;
  }

  public async getMetadata(): Promise<ContentMetadata | null> {
    this.getMetadataCalled = true;
    return this.savedMetadata;
  }

  public async initialize(): Promise<void> {
    // Mock implementation
  }

  public async hasCurrentContent(): Promise<boolean> {
    return true;
  }

  public getCurrentPath(): string {
    return "/data/current";
  }

  public async getCurrentVersion(): Promise<string | null> {
    return this.savedMetadata?.commitHash || null;
  }
}

describe.skip("UpdateScheduler", () => {
  let scheduler: UpdateScheduler;
  let mockContentFetcher: MockContentFetcher;
  let mockFileSystemManager: MockFileSystemManager;
  let mockLogger: Logger;

  beforeEach(() => {
    jest.useFakeTimers();
    mockContentFetcher = new MockContentFetcher();
    mockFileSystemManager = new MockFileSystemManager();
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    scheduler = new UpdateScheduler(
      {
        updateDelay: 100,
        updateInterval: 1000,
      },
      mockContentFetcher,
      mockFileSystemManager as unknown as FileSystemManager,
      mockLogger,
    );
  });

  afterEach(() => {
    // Clear any pending timeouts
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe("initialize", () => {
    it("should load metadata on initialization", async () => {
      const testMetadata: ContentMetadata = {
        commitHash: "test123",
        fetchTime: new Date(),
        branch: "main",
        repository: "test/repo",
        totalFiles: 5,
      };
      await mockFileSystemManager.saveMetadata(testMetadata);

      await scheduler.initialize();

      expect(mockFileSystemManager.getMetadataCalled).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Loaded last update time from metadata"));
    });
  });

  describe("scheduleUpdate", () => {
    it("should schedule an update with default delay", () => {
      const scheduledPromise = new Promise<Date>((resolve) => {
        scheduler.on("update-scheduled", resolve);
      });

      scheduler.scheduleUpdate();

      return scheduledPromise.then((scheduledTime) => {
        expect(scheduledTime).toBeInstanceOf(Date);
        const delay = scheduledTime.getTime() - Date.now();
        expect(delay).toBeGreaterThan(50);
        expect(delay).toBeLessThan(150);
      });
    });

    it("should cancel existing scheduled update", () => {
      scheduler.scheduleUpdate();
      const status1 = scheduler.getStatus();
      expect(status1.scheduledUpdateTime).not.toBeNull();

      // Advance time a bit to ensure different timestamp
      jest.advanceTimersByTime(10);

      scheduler.scheduleUpdate();
      const status2 = scheduler.getStatus();
      expect(status2.scheduledUpdateTime).not.toBeNull();
      expect(status2.scheduledUpdateTime?.getTime()).toBeGreaterThan(status1.scheduledUpdateTime!.getTime());
    });

    it("should respect throttle interval", async () => {
      // Perform an update
      await scheduler.forceUpdate();

      // Try to schedule immediately after
      scheduler.scheduleUpdate();

      // Should be throttled
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Update throttled"));
    });

    it("should abort running update when new one is scheduled", () => {
      // Start an update
      scheduler.forceUpdate();
      expect(scheduler.isUpdateInProgress()).toBe(true);

      // Schedule new update
      scheduler.scheduleUpdate();

      expect(mockContentFetcher.abortFetchCalled).toBe(true);
    });
  });

  describe("forceUpdate", () => {
    it("should perform successful update", async () => {
      await scheduler.forceUpdate();

      expect(mockFileSystemManager.getTempDirectoryCalled).toBe(true);
      expect(mockContentFetcher.fetchAllContentCalled).toBe(true);
      expect(mockFileSystemManager.validateContentCalled).toBe(true);
      expect(mockFileSystemManager.swapDirectoriesCalled).toBe(true);
      expect(mockFileSystemManager.saveMetadataCalled).toBe(true);

      const status = scheduler.getStatus();
      expect(status.lastUpdateTime).not.toBeNull();
      expect(status.failedUpdates).toBe(0);
    });

    it("should handle fetch failure", async () => {
      mockContentFetcher.shouldFail = true;

      await expect(scheduler.forceUpdate()).rejects.toThrow("Fetch failed");

      const status = scheduler.getStatus();
      expect(status.failedUpdates).toBe(1);
      expect(mockFileSystemManager.cleanupTempDirectoryCalled).toBe(true);
    });

    it("should handle validation failure", async () => {
      mockFileSystemManager.shouldValidateFail = true;

      await expect(scheduler.forceUpdate()).rejects.toThrow("Content validation failed");

      const status = scheduler.getStatus();
      expect(status.failedUpdates).toBe(1);
    });

    it("should throw error if update already in progress", async () => {
      // Start first update
      const update1 = scheduler.forceUpdate();

      // Try to start another
      await expect(scheduler.forceUpdate()).rejects.toThrow("Update already in progress");

      // Wait for first to complete
      await update1;
    });
  });

  describe("getStatus", () => {
    it("should return correct initial status", () => {
      const status = scheduler.getStatus();

      expect(status.lastUpdateTime).toBeNull();
      expect(status.scheduledUpdateTime).toBeNull();
      expect(status.updateInProgress).toBe(false);
      expect(status.failedUpdates).toBe(0);
      expect(status.currentVersion).toBeNull();
    });

    it("should return correct status after successful update", async () => {
      await scheduler.forceUpdate();

      const status = scheduler.getStatus();
      expect(status.lastUpdateTime).not.toBeNull();
      expect(status.updateInProgress).toBe(false);
      expect(status.failedUpdates).toBe(0);
    });

    it("should return correct status when update is scheduled", () => {
      scheduler.scheduleUpdate();

      const status = scheduler.getStatus();
      expect(status.scheduledUpdateTime).not.toBeNull();
      expect(status.updateInProgress).toBe(false);
    });
  });

  describe("event emissions", () => {
    it("should emit update-started event", () => {
      const startedPromise = new Promise<void>((resolve) => {
        scheduler.on("update-started", () => {
          expect(scheduler.isUpdateInProgress()).toBe(true);
          resolve();
        });
      });

      scheduler.forceUpdate();
      return startedPromise;
    });

    it("should emit update-completed event", async () => {
      const completedPromise = new Promise<void>((resolve) => {
        scheduler.on("update-completed", () => {
          expect(scheduler.isUpdateInProgress()).toBe(false);
          resolve();
        });
      });

      await scheduler.forceUpdate();
      return completedPromise;
    });

    it("should emit update-failed event on failure", async () => {
      mockContentFetcher.shouldFail = true;

      const errorPromise = new Promise((resolve) => {
        scheduler.on("update-failed", (error) => {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe("Fetch failed");
          resolve(error);
        });
      });

      await expect(scheduler.forceUpdate()).rejects.toThrow("Fetch failed");
      await errorPromise;
    });

    it("should emit update-progress event", () => {
      const progressPromise = new Promise<void>((resolve) => {
        scheduler.on("update-progress", (progress) => {
          expect(progress.totalFiles).toBe(10);
          expect(progress.fetchedFiles).toBe(10);
          resolve();
        });
      });

      scheduler.forceUpdate();
      return progressPromise;
    });
  });
});
