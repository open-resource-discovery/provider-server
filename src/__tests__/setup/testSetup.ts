// eslint-disable-next-line @typescript-eslint/no-explicit-any
const logger: any = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  fatal: jest.fn(),
  trace: jest.fn(),
  silent: jest.fn(),
  child: (): typeof logger => logger,
  level: "silent",
};

export function setupTestEnvironment(): void {
  jest.mock("src/util/logger.js", () => ({
    log: {
      ...logger,
    },
  }));
  jest.resetModules();
}

setupTestEnvironment();
