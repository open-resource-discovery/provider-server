import { vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: Existing exception retained during tooling migration.
const logger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  child: (): typeof logger => logger,
  level: "silent",
}));

vi.mock("src/util/logger.js", () => ({ log: { ...logger } }));

// Mock the gitWorkerManager to avoid worker thread issues in tests
vi.mock("src/services/gitWorkerManager.js");

vi.resetModules();
