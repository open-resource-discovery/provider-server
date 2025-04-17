import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import fs from "node:fs";
import path from "node:path";
import { log } from "../util/logger.js";

export function getPackageVersion(): string {
  try {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJsonContent = fs.readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.version || "unknown";
  } catch (error) {
    log.error("Failed to read package.json version:", error);
    return "unknown";
  }
}

const version = getPackageVersion();

function statusRouter(fastify: FastifyInstance, _opts: FastifyPluginOptions, done: (err?: Error) => void): void {
  fastify.get("/api/v1/status", (_request: FastifyRequest, _reply: FastifyReply) => {
    return { version };
  });
  done();
}

export default fp(statusRouter, {
  name: "status-router",
});
