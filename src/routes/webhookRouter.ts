import { FastifyRequest, FastifyReply } from "fastify";
import { UpdateScheduler } from "../services/updateScheduler.js";
import { Logger } from "pino";
import { createHmac, timingSafeEqual } from "crypto";

interface WebhookConfig {
  secret?: string;
  branch: string;
  repository: string;
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

  private verifySignature(payload: string, signature: string, secret: string): boolean {
    const hmac = createHmac("sha256", secret);
    hmac.update(payload);
    const expectedSignature = `sha256=${hmac.digest("hex")}`;

    this.logger.debug("Signature verification details:");
    this.logger.debug("  Payload length: %d", payload.length);
    this.logger.debug("  Expected: %s", expectedSignature);
    this.logger.debug("  Received: %s", signature);

    try {
      const expected = Buffer.from(expectedSignature);
      const received = Buffer.from(signature);

      // Check if buffers are same length before comparing
      if (expected.length !== received.length) {
        this.logger.debug("  Signature length mismatch - expected: %d, received: %d", expected.length, received.length);
        return false;
      }

      const equal = timingSafeEqual(expected, received);
      this.logger.debug("  Signatures match: %s", equal);
      return equal;
    } catch (error) {
      this.logger.debug("Signature comparison error:", error);
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public register(fastify: any): void {
    fastify.post("/api/v1/webhook/github", {
      config: {
        rawBody: true,
      },
      preHandler: (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
        const isManualTrigger = request.headers["x-manual-trigger"] === "true";

        // Skip signature verification for manual triggers (they're already authenticated)
        if (isManualTrigger) {
          this.logger.debug("Manual trigger detected, skipping signature verification");
          done();
          return;
        }

        // Validate webhook signature if secret is configured
        if (this.config.secret) {
          const signature = request.headers["x-hub-signature-256"] as string;
          if (!signature) {
            return reply.code(401).send({ error: "Missing signature" });
          }

          this.logger.debug("Webhook signature verification:");
          this.logger.debug("  Received signature: %s", signature);

          const rawBody = request.rawBody as string;
          if (!rawBody) {
            return reply.code(400).send({ error: "Missing request body" });
          }

          if (!this.verifySignature(rawBody, signature, this.config.secret)) {
            return reply.code(401).send({ error: "Invalid signature" });
          }
        }
        done();
      },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        // Check if this is a manual trigger
        const isManualTrigger = request.headers["x-manual-trigger"] === "true";

        if (isManualTrigger) {
          // Skip all validation for manual triggers - just trigger the update
          this.logger.info("Manual update trigger received");
          try {
            await this.updateScheduler.scheduleImmediateUpdate(true);
            return reply.code(200).send({
              status: "triggered",
              message: "Manual update triggered successfully",
            });
          } catch (error) {
            this.logger.error("Failed to trigger manual update:", error);
            return reply.code(500).send({
              status: "error",
              message: "Failed to trigger update",
            });
          }
        }

        // Normal webhook processing - check branch
        const payload = request.body as GithubWebhookPayload;
        if (payload.repository.full_name.toLowerCase() !== this.config.repository.toLowerCase()) {
          this.logger.warn(
            "Webhook rejected: repository mismatch - expected %s, got %s",
            this.config.repository,
            payload.repository.full_name,
          );
          return reply.code(400).send({
            status: "ignored",
            reason: "different repository",
          });
        }

        const expectedRef = `refs/heads/${this.config.branch}`;
        if (payload.ref !== expectedRef) {
          return reply.code(400).send({ status: "ignored", reason: "different branch" });
        }

        // Schedule immediate update
        try {
          await this.updateScheduler.scheduleImmediateUpdate();

          this.logger.info("Content update triggered immediately via webhook");
          return reply.code(200).send({
            status: "triggered",
            message: "Content update has been triggered immediately",
          });
        } catch (error) {
          this.logger.error("Failed to trigger immediate update:", error);
          return reply.code(500).send({
            status: "error",
            message: "Failed to trigger update",
          });
        }
      },
    });
  }
}
