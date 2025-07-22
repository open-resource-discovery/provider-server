import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import fs from "node:fs";
import path from "node:path";
import { log } from "../util/logger.js";
import { FileSystemManager } from "../services/fileSystemManager.js";
import { UpdateScheduler } from "../services/updateScheduler.js";
import { PATH_CONSTANTS } from "../constant.js";
import { StatusService } from "../services/statusService.js";

interface StatusRouterOptions extends FastifyPluginOptions {
  statusService: StatusService;
  fileSystemManager?: FileSystemManager | null;
  updateScheduler?: UpdateScheduler | null;
  statusDashboardEnabled?: boolean;
}

function statusRouter(fastify: FastifyInstance, opts: StatusRouterOptions, done: () => void): void {
  // Get paths to static files
  const publicPath = path.join(process.cwd(), "public");

  // Add REST endpoint for status data
  fastify.get("/api/v1/status", async (_request, _reply) => {
    return await opts.statusService.getStatus();
  });

  // Web UI endpoint - serve HTML directly
  fastify.get("/status", { logLevel: "error" }, (_request: FastifyRequest, reply: FastifyReply) => {
    // If status dashboard is disabled, redirect to ORD endpoint
    if (opts.statusDashboardEnabled === false) {
      return reply.redirect(PATH_CONSTANTS.WELL_KNOWN_ENDPOINT);
    }

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
  fastify.get("/css/status.css", { logLevel: "error" }, (_request: FastifyRequest, reply: FastifyReply) => {
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
  fastify.get("/js/status.js", { logLevel: "error" }, (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const jsPath = path.join(publicPath, "js", "status.js");
      const js = fs.readFileSync(jsPath, "utf-8");
      reply.type("application/javascript").send(js);
    } catch (error) {
      log.error("Failed to serve status.js:", error);
      reply.code(500).send("Failed to load script");
    }
  });

  return done();
}

export default fp(statusRouter, {
  name: "status-router",
});
