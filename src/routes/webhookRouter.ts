import { FastifyRequest, FastifyReply } from "fastify";
import { UpdateScheduler } from "../services/updateScheduler.js";
import { Logger } from "pino";
import { Webhooks } from "@octokit/webhooks";

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
  private readonly webhooks: Webhooks;

  public constructor(updateScheduler: UpdateScheduler, config: WebhookConfig, logger: Logger) {
    this.updateScheduler = updateScheduler;
    this.config = config;
    this.logger = logger;
    this.webhooks = new Webhooks({
      secret: config.secret || "",
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public register(fastify: any): void {
    fastify.post("/webhook/github", {
      config: {
        rawBody: true,
      },
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        // Validate webhook signature if secret is configured
        if (this.config.secret) {
          const signature = request.headers["x-hub-signature-256"] as string;
          if (!signature) {
            reply.code(401).send({ error: "Missing signature" });
            return;
          }

          this.logger.debug("Webhook signature verification:");
          this.logger.debug("  Received signature:", signature);
          if (!(await this.webhooks.verify(request.rawBody as string, signature))) {
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
