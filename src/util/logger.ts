import { pino, LoggerOptions } from "pino";

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
  });
}
