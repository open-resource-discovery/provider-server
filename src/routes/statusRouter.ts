import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import fs from "node:fs";
import path from "node:path";
import { log } from "../util/logger.js";
import { FileSystemManager } from "../services/fileSystemManager.js";
import { UpdateScheduler } from "../services/updateScheduler.js";

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

interface StatusRouterOptions extends FastifyPluginOptions {
  fileSystemManager?: FileSystemManager | null;
  updateScheduler?: UpdateScheduler | null;
}

interface StatusResponse {
  version: string;
  content?: {
    lastFetchTime: string | null;
    currentVersion: string | null;
    updateStatus: "idle" | "scheduled" | "in_progress" | "failed";
    scheduledUpdateTime?: string | null;
    failedUpdates: number;
  };
  github?: {
    repository?: string;
    branch?: string;
  };
}

function statusRouter(fastify: FastifyInstance, opts: StatusRouterOptions, done: (err?: Error) => void): void {
  // Get paths to static files
  const publicPath = path.join(process.cwd(), "public");

  // JSON API endpoint
  fastify.get("/api/v1/status", async (_request: FastifyRequest, _reply: FastifyReply): Promise<StatusResponse> => {
    const response: StatusResponse = {
      version,
    };

    if (opts.fileSystemManager && opts.updateScheduler) {
      const updateStatus = opts.updateScheduler.getStatus();
      const currentVersion = await opts.fileSystemManager.getCurrentVersion();

      response.content = {
        lastFetchTime: updateStatus.lastUpdateTime?.toISOString() || null,
        currentVersion: currentVersion,
        updateStatus: updateStatus.updateInProgress
          ? "in_progress"
          : updateStatus.scheduledUpdateTime
            ? "scheduled"
            : updateStatus.lastUpdateFailed
              ? "failed"
              : "idle",
        scheduledUpdateTime: updateStatus.scheduledUpdateTime?.toISOString() || null,
        failedUpdates: updateStatus.failedUpdates,
      };
    }

    return response;
  });

  // Web UI endpoint - serve HTML directly
  fastify.get("/status", (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const htmlPath = path.join(publicPath, "status.html");
      const html = fs.readFileSync(htmlPath, "utf-8");
      reply.type("text/html").send(html);
    } catch (error) {
      log.error("Failed to serve status.html:", error);
      reply.code(500).send("Failed to load status page");
    }
  });

  // Serve CSS
  fastify.get("/css/status.css", (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const cssPath = path.join(publicPath, "css", "status.css");
      const css = fs.readFileSync(cssPath, "utf-8");
      reply.type("text/css").send(css);
    } catch (error) {
      log.error("Failed to serve status.css:", error);
      reply.code(500).send("Failed to load styles");
    }
  });

  // Serve JavaScript
  fastify.get("/js/status.js", (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const jsPath = path.join(publicPath, "js", "status.js");
      const js = fs.readFileSync(jsPath, "utf-8");
      reply.type("application/javascript").send(js);
    } catch (error) {
      log.error("Failed to serve status.js:", error);
      reply.code(500).send("Failed to load script");
    }
  });

  done();
}

export default fp(statusRouter, {
  name: "status-router",
});
