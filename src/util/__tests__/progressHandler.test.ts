import { EventEmitter } from "events";
import { vi } from "vitest";
import type { ContentFetchProgress } from "../../services/interfaces/contentFetcher.js";
import { createProgressHandler } from "../progressHandler.js";

vi.mock("../logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("progressHandler", () => {
  // biome-ignore lint/suspicious/noExplicitAny: Existing exception retained during tooling migration.
  let mockLogger: any;
  let mockEmitter: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    mockEmitter = new EventEmitter();
  });

  describe("createProgressHandler", () => {
    it("should create a progress handler with default options", () => {
      const handler = createProgressHandler();
      expect(handler).toBeInstanceOf(Function);
    });

    it("should emit events when emitter is provided", () => {
      const emitSpy = vi.spyOn(mockEmitter, "emit");
      const handler = createProgressHandler({
        emitter: mockEmitter,
        emitEvent: "test-progress",
      });

      const progress: ContentFetchProgress = {
        totalFiles: 100,
        fetchedFiles: 50,
        startTime: new Date(),
        errors: [],
      };

      handler(progress);

      expect(emitSpy).toHaveBeenCalledWith("test-progress", progress);
    });

    it("should log progress at specified intervals", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const handler = createProgressHandler({
        logInterval: 1000,
        logger: mockLogger,
      });

      const progress: ContentFetchProgress = {
        totalFiles: 200,
        fetchedFiles: 100,
        startTime: new Date(),
        errors: [],
        phase: "Downloading",
      };

      // Advance time to trigger logging
      vi.advanceTimersByTime(1000);

      // First call - should log
      handler(progress);
      expect(mockLogger.info).toHaveBeenCalledWith("Downloading: 50% (100/200 git objects)");

      // Immediate second call - should not log (within interval)
      mockLogger.info.mockClear();
      handler({ ...progress, fetchedFiles: 101 });
      expect(mockLogger.info).not.toHaveBeenCalled();

      // Advance time past the interval
      vi.advanceTimersByTime(1500);

      // Third call - should log again
      handler({ ...progress, fetchedFiles: 150 });
      expect(mockLogger.info).toHaveBeenCalledWith("Downloading: 75% (150/200 git objects)");

      vi.useRealTimers();
    });

    it("should not log when totalFiles is 0", () => {
      const handler = createProgressHandler({ logger: mockLogger });

      const progress: ContentFetchProgress = {
        totalFiles: 0,
        fetchedFiles: 0,
        startTime: new Date(),
        errors: [],
      };

      handler(progress);
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it("should cap percentage at 99%", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const handler = createProgressHandler({ logger: mockLogger, logInterval: 1000 });

      const progress: ContentFetchProgress = {
        totalFiles: 100,
        fetchedFiles: 150, // More than total
        startTime: new Date(),
        errors: [],
        phase: "Processing",
      };

      vi.advanceTimersByTime(1000);
      handler(progress);
      expect(mockLogger.info).toHaveBeenCalledWith("Processing: 99% (150/100 git objects)");

      vi.useRealTimers();
    });

    it("should use default phase when not provided", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const handler = createProgressHandler({ logger: mockLogger, logInterval: 1000 });

      const progress: ContentFetchProgress = {
        totalFiles: 100,
        fetchedFiles: 50,
        startTime: new Date(),
        errors: [],
      };

      vi.advanceTimersByTime(1000);
      handler(progress);
      expect(mockLogger.info).toHaveBeenCalledWith("Syncing: 50% (50/100 git objects)");

      vi.useRealTimers();
    });

    it("should use custom log interval", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const handler = createProgressHandler({
        logInterval: 5000,
        logger: mockLogger,
      });

      const progress: ContentFetchProgress = {
        totalFiles: 100,
        fetchedFiles: 10,
        startTime: new Date(),
        errors: [],
        phase: "Cloning",
      };

      // Advance time to trigger first log
      vi.advanceTimersByTime(5000);
      handler(progress);
      expect(mockLogger.info).toHaveBeenCalled();

      mockLogger.info.mockClear();
      vi.advanceTimersByTime(3000);
      handler({ ...progress, fetchedFiles: 20 });
      expect(mockLogger.info).not.toHaveBeenCalled();

      vi.advanceTimersByTime(3000);
      handler({ ...progress, fetchedFiles: 30 });
      expect(mockLogger.info).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("should handle both emit and log together", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const emitSpy = vi.spyOn(mockEmitter, "emit");
      const handler = createProgressHandler({
        emitter: mockEmitter,
        emitEvent: "progress",
        logger: mockLogger,
        logInterval: 1000,
      });

      const progress: ContentFetchProgress = {
        totalFiles: 100,
        fetchedFiles: 50,
        startTime: new Date(),
        errors: [],
        phase: "Fetching",
      };

      // Advance time to trigger logging
      vi.advanceTimersByTime(1000);
      handler(progress);

      expect(emitSpy).toHaveBeenCalledWith("progress", progress);
      expect(mockLogger.info).toHaveBeenCalledWith("Fetching: 50% (50/100 git objects)");

      vi.useRealTimers();
    });
  });
});
