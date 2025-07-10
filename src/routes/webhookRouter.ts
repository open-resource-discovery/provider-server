import { FastifyRequest, FastifyReply } from "fastify";
import * as crypto from "crypto";
import { UpdateScheduler } from "../services/updateScheduler.js";
import { Logger } from "pino";

interface WebhookConfig {
  secret?: string;
  branch: string;
}

interface GithubWebhookPayload {
  ref: string;
  repository: {
    full_name: string;
    default_branch: string;
  };
  commits?: {
    modified: string[];
    added: string[];
    removed: string[];
  }[];
}

export class WebhookRouter {
  private readonly updateScheduler: UpdateScheduler;
  private readonly config: WebhookConfig;
  private readonly logger: Logger;

  public constructor(updateScheduler: UpdateScheduler, config: WebhookConfig, logger: Logger) {
    this.updateScheduler = updateScheduler;
    this.config = config;
    this.logger = logger;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public register(fastify: any): void {
    fastify.post("/webhook/github", {
      preHandler: (request: FastifyRequest, reply: FastifyReply) => {
        // Validate webhook signature if secret is configured
        if (this.config.secret) {
          const signature = request.headers["x-hub-signature-256"] as string;
          if (!signature) {
            reply.code(401).send({ error: "Missing signature" });
            return;
          }

          const payload = JSON.stringify(request.body);
          const expectedSignature = `sha256=${crypto
            .createHmac("sha256", this.config.secret)
            .update(payload)
            .digest("hex")}`;

          if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
            reply.code(401).send({ error: "Invalid signature" });
            return;
          }
        }
      },
      handler: (request: FastifyRequest, reply: FastifyReply) => {
        const payload = request.body as GithubWebhookPayload;

        // Check if this is a push event to our configured branch
        const expectedRef = `refs/heads/${this.config.branch}`;
        if (payload.ref !== expectedRef) {
          this.logger.info(`Ignoring webhook for ref ${payload.ref} (expected ${expectedRef})`);
          reply.code(200).send({ status: "ignored", reason: "different branch" });
          return;
        }

        // Schedule update
        try {
          this.updateScheduler.scheduleUpdate();

          this.logger.info("Content update scheduled via webhook");
          reply.code(200).send({
            status: "scheduled",
            message: "Content update has been scheduled",
          });
        } catch (error) {
          this.logger.error("Failed to schedule update:", error);
          reply.code(500).send({
            status: "error",
            message: "Failed to schedule update",
          });
        }
      },
    });

    // Health check endpoint for webhook
    fastify.get("/webhook/health", (_request: FastifyRequest, reply: FastifyReply) => {
      reply.code(200).send({ status: "ok" });
    });
  }
}
