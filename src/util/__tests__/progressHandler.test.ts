import { createProgressHandler } from "../progressHandler.js";
import { EventEmitter } from "events";
import { ContentFetchProgress } from "../../services/interfaces/contentFetcher.js";

jest.mock("../logger.js", () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("progressHandler", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockLogger: any;
  let mockEmitter: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    mockEmitter = new EventEmitter();
  });

  describe("createProgressHandler", () => {
    it("should create a progress handler with default options", () => {
      const handler = createProgressHandler();
      expect(handler).toBeInstanceOf(Function);
    });

    it("should emit events when emitter is provided", () => {
      const emitSpy = jest.spyOn(mockEmitter, "emit");
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
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);

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
      jest.advanceTimersByTime(1000);

      // First call - should log
      handler(progress);
      expect(mockLogger.info).toHaveBeenCalledWith("Downloading: 50% (100/200 git objects)");

      // Immediate second call - should not log (within interval)
      mockLogger.info.mockClear();
      handler({ ...progress, fetchedFiles: 101 });
      expect(mockLogger.info).not.toHaveBeenCalled();

      // Advance time past the interval
      jest.advanceTimersByTime(1500);

      // Third call - should log again
      handler({ ...progress, fetchedFiles: 150 });
      expect(mockLogger.info).toHaveBeenCalledWith("Downloading: 75% (150/200 git objects)");

      jest.useRealTimers();
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
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);

      const handler = createProgressHandler({ logger: mockLogger, logInterval: 1000 });

      const progress: ContentFetchProgress = {
        totalFiles: 100,
        fetchedFiles: 150, // More than total
        startTime: new Date(),
        errors: [],
        phase: "Processing",
      };

      jest.advanceTimersByTime(1000);
      handler(progress);
      expect(mockLogger.info).toHaveBeenCalledWith("Processing: 99% (150/100 git objects)");

      jest.useRealTimers();
    });

    it("should use default phase when not provided", () => {
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);

      const handler = createProgressHandler({ logger: mockLogger, logInterval: 1000 });

      const progress: ContentFetchProgress = {
        totalFiles: 100,
        fetchedFiles: 50,
        startTime: new Date(),
        errors: [],
      };

      jest.advanceTimersByTime(1000);
      handler(progress);
      expect(mockLogger.info).toHaveBeenCalledWith("Syncing: 50% (50/100 git objects)");

      jest.useRealTimers();
    });

    it("should use custom log interval", () => {
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);

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
      jest.advanceTimersByTime(5000);
      handler(progress);
      expect(mockLogger.info).toHaveBeenCalled();

      mockLogger.info.mockClear();
      jest.advanceTimersByTime(3000);
      handler({ ...progress, fetchedFiles: 20 });
      expect(mockLogger.info).not.toHaveBeenCalled();

      jest.advanceTimersByTime(3000);
      handler({ ...progress, fetchedFiles: 30 });
      expect(mockLogger.info).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it("should handle both emit and log together", () => {
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);

      const emitSpy = jest.spyOn(mockEmitter, "emit");
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
      jest.advanceTimersByTime(1000);
      handler(progress);

      expect(emitSpy).toHaveBeenCalledWith("progress", progress);
      expect(mockLogger.info).toHaveBeenCalledWith("Fetching: 50% (50/100 git objects)");

      jest.useRealTimers();
    });
  });
});
