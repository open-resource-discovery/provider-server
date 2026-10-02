import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import fastifyStatic from "@fastify/static";
import path from "node:path";
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

async function statusRouter(fastify: FastifyInstance, opts: StatusRouterOptions): Promise<void> {
  const distUiPath = path.join(process.cwd(), "dist", "ui");

  // Serve Vite-built React assets at /status-ui/*
  await fastify.register(fastifyStatic, {
    root: distUiPath,
    prefix: "/status-ui/",
  });

  // REST endpoint for status data
  fastify.get("/api/v1/status", async (_request, _reply) => {
    return await opts.statusService.getStatus();
  });

  const serveUi = (_request: FastifyRequest, reply: FastifyReply): void => {
    if (opts.statusDashboardEnabled === false) {
      void reply.redirect(PATH_CONSTANTS.WELL_KNOWN_ENDPOINT);
      return;
    }
    void reply.sendFile("index.html");
  };

  // Serve React SPA for /status and all sub-paths (client-side routing)
  fastify.get("/status", { logLevel: "error" }, serveUi);
  fastify.get("/status/*", { logLevel: "error" }, serveUi);
}

export default fp(statusRouter, {
  name: "status-router",
});
