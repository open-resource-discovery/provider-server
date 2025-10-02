import { config } from "dotenv";
config();

import { pino, LoggerOptions } from "pino";

const VALID_LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

function getLogLevel(): string {
  const envLogLevel = process.env.LOG_LEVEL?.toLowerCase();

  if (envLogLevel && VALID_LOG_LEVELS.includes(envLogLevel)) {
    return envLogLevel;
  }

  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

export const envToLogger: { [environment: string]: LoggerOptions | boolean } = {
  development: {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
  },
  production: true,
  test: false,
};

/**
 * The logger instance we're going to use
 * Configured differently for dev and production
 */
export let log = pino();

const logLevel = getLogLevel();

if (process.env.NODE_ENV !== "production") {
  log = pino({
    transport: {
      // Enable pretty print when dev dependencies are installed
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
      },
    },
    base: null, // avoid adding pid, hostname and name properties to each log.
    level: logLevel,
  });
} else {
  log = pino({
    level: logLevel,
  });
}
