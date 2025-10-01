import { FastifyRequest, FastifyReply } from "fastify";
import { UpdateStateManager } from "../services/updateStateManager.js";
import { log } from "../util/logger.js";
import { PATH_CONSTANTS } from "../constant.js";
import { TimeoutError } from "../model/error/SystemErrors.js";

/**
 * Readiness gate middleware that holds requests during git clone/pull operations
 * Prevents 404 errors during initialization by waiting for operations to complete
 */
export function createReadinessGate(updateStateManager?: UpdateStateManager) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Skip gate if no state manager (local mode doesn't need waiting)
    if (!updateStateManager) {
      return;
    }

    // Only gate well-known and ord/v1 routes that need documents to be ready
    const path = request.url.split("?")[0];
    const shouldGate = path === PATH_CONSTANTS.WELL_KNOWN_ENDPOINT || path.startsWith(PATH_CONSTANTS.SERVER_PREFIX);

    if (!shouldGate) {
      return;
    }

    try {
      await updateStateManager.waitForReady();
    } catch (error) {
      const timeoutError = TimeoutError.fromWaitError(
        error instanceof Error ? error : new Error(String(error)),
        "content initialization",
      );

      log.error(`Request timeout waiting for update: ${timeoutError.message}`);

      return reply.code(timeoutError.getHttpStatusCode()).send(timeoutError.getErrorResponse());
    }
  };
}
