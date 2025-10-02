import { UpdateStateManager, UpdateStatus } from "../updateStateManager.js";
import { Logger } from "pino";

describe("UpdateStateManager", () => {
  let stateManager: UpdateStateManager;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    stateManager = new UpdateStateManager(mockLogger);
  });

  afterEach(() => {
    stateManager.removeAllListeners();
  });

  describe("initial state", () => {
    it("should start with idle status", () => {
      const state = stateManager.getState();
      expect(state.status).toBe("idle");
      expect(state.updateInProgress).toBe(false);
      expect(state.failedUpdates).toBe(0);
    });

    it("should not be in progress initially", () => {
      expect(stateManager.isUpdateInProgress()).toBe(false);
    });
  });

  describe("state transitions", () => {
    it("should transition from idle to in_progress", () => {
      const stateChangedSpy = jest.fn();
      stateManager.on("state-changed", stateChangedSpy);

      stateManager.startUpdate("validation");

      const state = stateManager.getState();
      expect(state.status).toBe("in_progress");
      expect(state.updateInProgress).toBe(true);
      expect(state.source).toBe("validation");
      expect(stateChangedSpy).toHaveBeenCalled();
    });

    it("should transition from in_progress to idle on success", () => {
      stateManager.startUpdate("scheduler");
      stateManager.completeUpdate();

      const state = stateManager.getState();
      expect(state.status).toBe("idle");
      expect(state.updateInProgress).toBe(false);
      expect(state.lastUpdateTime).toBeInstanceOf(Date);
      expect(state.failedUpdates).toBe(0);
    });

    it("should transition from in_progress to failed on error", () => {
      stateManager.startUpdate("webhook");
      stateManager.failUpdate("Test error", "abc123");

      const state = stateManager.getState();
      expect(state.status).toBe("failed");
      expect(state.updateInProgress).toBe(false);
      expect(state.lastError).toBe("Test error");
      expect(state.failedCommitHash).toBe("abc123");
      expect(state.failedUpdates).toBe(1);
    });

    it("should transition to scheduled state", () => {
      const scheduledTime = new Date();
      stateManager.scheduleUpdate(scheduledTime);

      const state = stateManager.getState();
      expect(state.status).toBe("scheduled");
      expect(state.scheduledTime).toBe(scheduledTime);
      expect(state.updateInProgress).toBe(false);
    });

    it("should increment failed updates counter on multiple failures", () => {
      stateManager.startUpdate("scheduler");
      stateManager.failUpdate("Error 1");
      expect(stateManager.getState().failedUpdates).toBe(1);

      stateManager.startUpdate("scheduler");
      stateManager.failUpdate("Error 2");
      expect(stateManager.getState().failedUpdates).toBe(2);
    });

    it("should reset failed updates counter on successful completion", () => {
      stateManager.startUpdate("scheduler");
      stateManager.failUpdate("Error");
      expect(stateManager.getState().failedUpdates).toBe(1);

      stateManager.startUpdate("scheduler");
      stateManager.completeUpdate();
      expect(stateManager.getState().failedUpdates).toBe(0);
    });
  });

  describe("event emissions", () => {
    it("should emit update-started event", () => {
      const spy = jest.fn();
      stateManager.on("update-started", spy);

      stateManager.startUpdate("validation");

      expect(spy).toHaveBeenCalled();
    });

    it("should emit update-completed event", () => {
      const spy = jest.fn();
      stateManager.on("update-completed", spy);

      stateManager.startUpdate("scheduler");
      stateManager.completeUpdate();

      expect(spy).toHaveBeenCalled();
    });

    it("should emit update-failed event with error message", () => {
      const spy = jest.fn();
      stateManager.on("update-failed", spy);

      stateManager.startUpdate("webhook");
      stateManager.failUpdate("Test error");

      expect(spy).toHaveBeenCalledWith("Test error");
    });

    it("should emit update-scheduled event with scheduled time", () => {
      const spy = jest.fn();
      const scheduledTime = new Date();
      stateManager.on("update-scheduled", spy);

      stateManager.scheduleUpdate(scheduledTime);

      expect(spy).toHaveBeenCalledWith(scheduledTime);
    });

    it("should emit state-changed event with previous and current state", () => {
      const spy = jest.fn();
      stateManager.on("state-changed", spy);

      stateManager.startUpdate("manual");

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "state-changed",
          previousState: expect.objectContaining({ status: "idle" }),
          currentState: expect.objectContaining({ status: "in_progress", source: "manual" }),
        }),
      );
    });

    it("should emit update-progress event", () => {
      const spy = jest.fn();
      const progress = {
        totalFiles: 100,
        fetchedFiles: 50,
        startTime: new Date(),
        errors: [],
      };
      stateManager.on("update-progress", spy);

      stateManager.setProgress(progress, "Downloading");

      expect(spy).toHaveBeenCalledWith(progress);
    });
  });

  describe("setProgress", () => {
    it("should update progress and phase", () => {
      const progress = {
        totalFiles: 100,
        fetchedFiles: 50,
        startTime: new Date(),
        errors: [],
      };

      stateManager.setProgress(progress, "Cloning");

      const state = stateManager.getState();
      expect(state.progress).toBe(progress);
      expect(state.phase).toBe("Cloning");
    });

    it("should use progress.phase if phase parameter not provided", () => {
      const progress = {
        totalFiles: 100,
        fetchedFiles: 50,
        startTime: new Date(),
        errors: [],
        phase: "Receiving objects",
      };

      stateManager.setProgress(progress);

      const state = stateManager.getState();
      expect(state.phase).toBe("Receiving objects");
    });
  });

  describe("reset", () => {
    it("should reset to idle state", () => {
      stateManager.startUpdate("scheduler");
      stateManager.setProgress({
        totalFiles: 100,
        fetchedFiles: 50,
        startTime: new Date(),
        errors: [],
      });

      stateManager.reset();

      const state = stateManager.getState();
      expect(state.status).toBe("idle");
      expect(state.updateInProgress).toBe(false);
      expect(state.source).toBeUndefined();
      expect(state.phase).toBeUndefined();
      expect(state.progress).toBeUndefined();
      expect(state.scheduledTime).toBeUndefined();
    });
  });

  describe("helper methods", () => {
    it("should return update in progress status", () => {
      expect(stateManager.isUpdateInProgress()).toBe(false);

      stateManager.startUpdate("validation");
      expect(stateManager.isUpdateInProgress()).toBe(true);

      stateManager.completeUpdate();
      expect(stateManager.isUpdateInProgress()).toBe(false);
    });

    it("should return last update time", () => {
      expect(stateManager.getLastUpdateTime()).toBeUndefined();

      stateManager.startUpdate("scheduler");
      stateManager.completeUpdate();

      const lastUpdateTime = stateManager.getLastUpdateTime();
      expect(lastUpdateTime).toBeInstanceOf(Date);
    });

    it("should return update source", () => {
      expect(stateManager.getUpdateSource()).toBeUndefined();

      stateManager.startUpdate("webhook");
      expect(stateManager.getUpdateSource()).toBe("webhook");
    });
  });

  describe("waitForReady", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should resolve immediately when not in progress", async () => {
      await expect(stateManager.waitForReady()).resolves.toBeUndefined();
    });

    it("should wait for update-completed event when in progress", async () => {
      stateManager.startUpdate("scheduler");

      const waitPromise = stateManager.waitForReady();

      // Simulate async completion
      setTimeout(() => {
        stateManager.completeUpdate();
      }, 100);

      jest.advanceTimersByTime(100);

      await expect(waitPromise).resolves.toBeUndefined();
    });

    it("should resolve on update-failed event", async () => {
      stateManager.startUpdate("validation");

      const waitPromise = stateManager.waitForReady();

      // Simulate failure
      setTimeout(() => {
        stateManager.failUpdate("Test error");
      }, 100);

      jest.advanceTimersByTime(100);

      // Should still resolve (not reject) on failure
      await expect(waitPromise).resolves.toBeUndefined();
    });

    it("should reject on timeout", async () => {
      stateManager.startUpdate("scheduler");

      const waitPromise = stateManager.waitForReady(1000);

      // Advance past timeout
      jest.advanceTimersByTime(1001);

      await expect(waitPromise).rejects.toThrow("Timeout waiting for update to complete");
    });

    it("should handle race condition where update completes before listener setup", async () => {
      stateManager.startUpdate("scheduler");

      // Complete immediately
      stateManager.completeUpdate();

      // waitForReady should still resolve
      await expect(stateManager.waitForReady()).resolves.toBeUndefined();
    });

    it("should use custom timeout", async () => {
      stateManager.startUpdate("validation");

      const customTimeout = 500;
      const waitPromise = stateManager.waitForReady(customTimeout);

      jest.advanceTimersByTime(customTimeout + 1);

      await expect(waitPromise).rejects.toThrow(`Timeout waiting for update to complete (${customTimeout}ms)`);
    });

    it("should clean up listeners on completion", async () => {
      stateManager.startUpdate("scheduler");

      const waitPromise = stateManager.waitForReady();

      setTimeout(() => {
        stateManager.completeUpdate();
      }, 100);

      jest.advanceTimersByTime(100);
      await waitPromise;

      expect(stateManager.isUpdateInProgress()).toBe(false);
    });

    it("should handle multiple concurrent waitForReady calls", async () => {
      stateManager.startUpdate("scheduler");

      const wait1 = stateManager.waitForReady();
      const wait2 = stateManager.waitForReady();
      const wait3 = stateManager.waitForReady();

      setTimeout(() => {
        stateManager.completeUpdate();
      }, 100);

      jest.advanceTimersByTime(100);

      await expect(Promise.all([wait1, wait2, wait3])).resolves.toEqual([undefined, undefined, undefined]);
    });
  });

  describe("getState", () => {
    it("should return a copy of the state", () => {
      const state1 = stateManager.getState();
      const state2 = stateManager.getState();

      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });

    it("should not allow external mutation", () => {
      const state = stateManager.getState();
      state.status = "failed" as UpdateStatus;

      const actualState = stateManager.getState();
      expect(actualState.status).toBe("idle");
    });
  });
});
