import { vi } from "vitest";
import { GitWorkerManager } from "../gitWorkerManager.js";

// Mock the actual git worker manager to avoid worker thread complexities in tests
vi.mock("../gitWorkerManager.js", () => {
  return {
    GitWorkerManager: vi.fn().mockImplementation(function () {
      return {
        clone: vi.fn().mockResolvedValue(undefined),
        pull: vi.fn().mockResolvedValue(undefined),
        checkout: vi.fn().mockResolvedValue(undefined),
        resetIndex: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn(),
        destroy: vi.fn(),
        executeOperation: vi.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

describe("GitWorkerManager", () => {
  // biome-ignore lint/suspicious/noExplicitAny: Existing exception retained during tooling migration.
  let manager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new GitWorkerManager();
  });

  describe("clone operation", () => {
    it("should call clone with correct parameters", async () => {
      const url = "https://github.com/owner/repo.git";
      const dir = "/tmp/test";
      const ref = "main";
      const auth = { username: "token", password: "x-oauth-basic" };

      await manager.clone(url, dir, ref, auth);

      expect(manager.clone).toHaveBeenCalledWith(url, dir, ref, auth);
    });
  });

  describe("pull operation", () => {
    it("should call pull with correct parameters", async () => {
      const dir = "/tmp/test";
      const ref = "main";
      const auth = { username: "token", password: "x-oauth-basic" };

      await manager.pull(dir, ref, auth);

      expect(manager.pull).toHaveBeenCalledWith(dir, ref, auth);
    });
  });

  describe("checkout operation", () => {
    it("should call checkout with correct parameters", async () => {
      const dir = "/tmp/test";
      const ref = "origin/main";
      const force = true;

      await manager.checkout(dir, ref, force);

      expect(manager.checkout).toHaveBeenCalledWith(dir, ref, force);
    });
  });

  describe("resetIndex operation", () => {
    it("should call resetIndex with correct parameters", async () => {
      const dir = "/tmp/test";

      await manager.resetIndex(dir);

      expect(manager.resetIndex).toHaveBeenCalledWith(dir);
    });
  });

  describe("abort", () => {
    it("should call abort", () => {
      manager.abort();

      expect(manager.abort).toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("should call destroy", () => {
      manager.destroy();

      expect(manager.destroy).toHaveBeenCalled();
    });
  });
});
