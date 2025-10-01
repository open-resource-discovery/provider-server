import { UpdateScheduler } from "../updateScheduler.js";
import { ContentFetcher, ContentFetchProgress, ContentMetadata } from "../interfaces/contentFetcher.js";
import { FileSystemManager } from "../fileSystemManager.js";
import { UpdateStateManager } from "../updateStateManager.js";
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

  public async getLatestCommitSha(): Promise<string> {
    return await "latest123commit";
  }

  public async getDirectoryTreeSha(): Promise<string | null> {
    return await "directorySha789";
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
  public savedMetadata: ContentMetadata | null = null;

  public async getTempDirectory(): Promise<string> {
    this.getTempDirectoryCalled = true;
    return await Promise.resolve("/tmp/test");
  }

  public async prepareTempDirectoryWithGit(): Promise<string> {
    this.getTempDirectoryCalled = true;
    return await Promise.resolve("/tmp/test");
  }

  public async validateContent(_directory: string): Promise<boolean> {
    this.validateContentCalled = true;
    return await Promise.resolve(!this.shouldValidateFail);
  }

  public async swapDirectories(_tempDir: string): Promise<void> {
    this.swapDirectoriesCalled = true;
    await Promise.resolve();
  }

  public async cleanupTempDirectory(): Promise<void> {
    this.cleanupTempDirectoryCalled = true;
    await Promise.resolve();
  }

  public async saveMetadata(metadata: ContentMetadata): Promise<void> {
    this.saveMetadataCalled = true;
    this.savedMetadata = metadata;
    await Promise.resolve();
  }

  public async getMetadata(): Promise<ContentMetadata | null> {
    this.getMetadataCalled = true;
    return await Promise.resolve(this.savedMetadata);
  }

  public async initialize(): Promise<void> {
    // Mock implementation
    await Promise.resolve();
  }

  public async hasCurrentContent(): Promise<boolean> {
    return await Promise.resolve(true);
  }

  public getCurrentPath(): string {
    return "/data/current";
  }

  public async getCurrentVersion(): Promise<string | null> {
    return await Promise.resolve(this.savedMetadata?.commitHash || null);
  }
}

describe("UpdateScheduler", () => {
  let scheduler: UpdateScheduler;
  let mockContentFetcher: MockContentFetcher;
  let mockFileSystemManager: MockFileSystemManager;
  let mockLogger: Logger;
  let mockStateManager: UpdateStateManager;

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

    mockStateManager = new UpdateStateManager(mockLogger);

    scheduler = new UpdateScheduler(
      {
        updateDelay: 100,
      },
      mockContentFetcher,
      mockFileSystemManager as unknown as FileSystemManager,
      mockLogger,
      mockStateManager,
    );

    // Reset the mock to ensure clean state
    mockContentFetcher.fetchAllContentCalled = false;
    mockContentFetcher.shouldFail = false;
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

  describe("scheduleImmediateUpdate", () => {
    it("should perform immediate update", async () => {
      await scheduler.scheduleImmediateUpdate();

      expect(mockFileSystemManager.getTempDirectoryCalled).toBe(true);
      expect(mockContentFetcher.fetchAllContentCalled).toBe(true);
      expect(mockFileSystemManager.validateContentCalled).toBe(true);
      expect(mockFileSystemManager.swapDirectoriesCalled).toBe(true);
      expect(mockFileSystemManager.saveMetadataCalled).toBe(true);
    });

    it("should respect webhook cooldown", async () => {
      // Use real timers for this test
      jest.useRealTimers();

      // Create a fresh scheduler to avoid cooldown from previous tests
      const freshScheduler = new UpdateScheduler(
        {
          updateDelay: 100,
        },
        mockContentFetcher,
        mockFileSystemManager as unknown as FileSystemManager,
        mockLogger,
        mockStateManager,
      );

      // First update
      await freshScheduler.scheduleImmediateUpdate();

      // Reset mocks
      mockLogger.info = jest.fn();

      // Try immediate second update - should be throttled
      await freshScheduler.scheduleImmediateUpdate();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Webhook update throttled"));

      // Re-enable fake timers
      jest.useFakeTimers();
    });

    it("should abort current update and process latest webhook request", async () => {
      // Use real timers for this test
      jest.useRealTimers();

      // Create fresh mocks for this test
      const freshContentFetcher = new MockContentFetcher();
      const freshFileSystemManager = new MockFileSystemManager();

      // Create a fresh scheduler to avoid any state from previous tests
      const freshScheduler = new UpdateScheduler(
        {
          updateDelay: 100,
        },
        freshContentFetcher,
        freshFileSystemManager as unknown as FileSystemManager,
        mockLogger,
        mockStateManager,
      );

      // Initialize to ensure clean state
      await freshScheduler.initialize();

      // Make the content fetcher slow so the update stays in progress
      let resolveFetch: (() => void) | undefined;
      freshContentFetcher.fetchAllContent = jest.fn().mockImplementation(async () => {
        // Wait for manual resolution
        await new Promise<void>((resolve) => {
          resolveFetch = resolve;
        });
        return {
          commitHash: "abc123def456",
          fetchTime: new Date(),
          branch: "main",
          repository: "owner/repo",
          totalFiles: 10,
        };
      });

      // Start first update but don't await it
      const firstUpdate = freshScheduler.scheduleImmediateUpdate();

      // Wait for fetch to be called and ensure update is in progress
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Wait for cooldown to pass (5 seconds + buffer)
      await new Promise((resolve) => setTimeout(resolve, 5100));

      // Reset mock logger to track new calls
      mockLogger.info = jest.fn();

      // Try to schedule another immediately - this should abort the current update
      void freshScheduler.scheduleImmediateUpdate();

      // Give it a moment to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockLogger.info).toHaveBeenCalledWith("Aborting current update to process latest webhook request");

      // Complete the first update
      if (resolveFetch) resolveFetch();

      // Wait for first update to complete
      await firstUpdate;

      // Re-enable fake timers
      jest.useFakeTimers();
    });

    it("should handle errors in immediate update", async () => {
      // Use real timers to avoid any timing issues
      jest.useRealTimers();

      // Create fresh mocks for this test
      const freshContentFetcher = new MockContentFetcher();
      const freshFileSystemManager = new MockFileSystemManager();

      // Create a fresh scheduler for this test to ensure clean state
      const freshScheduler = new UpdateScheduler(
        {
          updateDelay: 100,
        },
        freshContentFetcher,
        freshFileSystemManager as unknown as FileSystemManager,
        mockLogger,
        mockStateManager,
      );

      // Initialize to reset any previous state
      await freshScheduler.initialize();

      freshContentFetcher.shouldFail = true;

      await expect(freshScheduler.scheduleImmediateUpdate()).rejects.toThrow("Fetch failed");

      const status = freshScheduler.getStatus();
      expect(status.failedUpdates).toBe(1);

      // Re-enable fake timers
      jest.useFakeTimers();
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
          // Don't check isUpdateInProgress here as it might still be true during event emission
          resolve();
        });
      });

      await scheduler.forceUpdate();
      await completedPromise;

      // Check after event is handled
      expect(scheduler.isUpdateInProgress()).toBe(false);
    });

    it("should emit update-failed event on failure", async () => {
      // Create fresh mock fetcher for this test
      const testFetcher = new MockContentFetcher();
      testFetcher.shouldFail = true;

      // Create fresh file system manager
      const testFileSystemManager = new MockFileSystemManager();

      const testScheduler = new UpdateScheduler(
        {
          updateDelay: 100,
        },
        testFetcher,
        testFileSystemManager as unknown as FileSystemManager,
        mockLogger,
        mockStateManager,
      );

      let errorEmitted: Error | null = null;
      testScheduler.on("update-failed", (error) => {
        errorEmitted = error;
      });

      // Use scheduleImmediateUpdate which emits update-failed event
      try {
        await testScheduler.scheduleImmediateUpdate();
      } catch {
        // Expected to throw
      }

      // Check that error was emitted
      expect(errorEmitted).not.toBeNull();
      expect(errorEmitted).toBeInstanceOf(Error);
      expect(errorEmitted!.message).toBe("Fetch failed");
    });

    it("should emit update-progress event", async () => {
      const progressPromise = new Promise<void>((resolve) => {
        mockStateManager.on("update-progress", (progress) => {
          expect(progress.totalFiles).toBe(10);
          expect(progress.fetchedFiles).toBe(10);
          resolve();
        });
      });

      const updatePromise = scheduler.forceUpdate();
      await progressPromise;
      await updatePromise;
    });
  });

  describe("checkForUpdates", () => {
    it("should return true when no metadata exists", async () => {
      mockFileSystemManager.savedMetadata = null;

      const needsUpdate = await scheduler.checkForUpdates();
      expect(needsUpdate).toBe(true);
    });

    it("should return false when directory SHA matches", async () => {
      mockFileSystemManager.savedMetadata = {
        commitHash: "oldCommit123",
        directoryTreeSha: "directorySha789",
        fetchTime: new Date(),
        branch: "main",
        repository: "owner/repo",
        totalFiles: 10,
      };

      const needsUpdate = await scheduler.checkForUpdates();

      expect(needsUpdate).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining("Directory SHA match confirmed"));
    });

    it("should handle errors gracefully", async () => {
      // Make getMetadata throw an error
      mockFileSystemManager.getMetadata = jest.fn().mockRejectedValue(new Error("Read error"));

      const needsUpdate = await scheduler.checkForUpdates();

      expect(needsUpdate).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to check for updates"));
    });
  });
});
