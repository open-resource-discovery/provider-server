import { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from "fastify";
import { UnauthorizedError } from "src/model/error/UnauthorizedError.js";
import { log } from "src/util/logger.js";
import { TLSSocket } from "tls";

/**
 * Validates client certificates in mTLS authentication
 */
export function mtlsOnRequestHook(request: FastifyRequest, _: FastifyReply, done: HookHandlerDoneFunction): void {
  try {
    // Access the raw request from Node.js and check if it's a TLS connection
    const socket = request.raw.socket;

    if (!socket || !(socket instanceof TLSSocket)) {
      log.warn("mTLS authentication error: Not a TLS connection");
      return done(new UnauthorizedError("mTLS authentication failed: Not a TLS connection"));
    }

    // Check if client certificate was provided and validated
    if (!socket.authorized) {
      log.warn(`mTLS authentication failed: Unauthorized client certificate`);
      return done(new UnauthorizedError("Invalid client certificate"));
    }

    // Get certificate information for logging/debugging
    const clientCert = socket.getPeerCertificate();
    if (clientCert && clientCert.subject) {
      const subject = clientCert.subject;
      log.debug(`mTLS authentication successful for: ${subject.CN || "Unknown"}`);
      log.debug(
        `Certificate details - Subject: ${JSON.stringify(subject)}, Issuer: ${JSON.stringify(clientCert.issuer)}, Valid: ${clientCert.valid_from} to ${clientCert.valid_to}`,
      );
    }

    done();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      done(error);
    } else {
      log.error(`mTLS authentication error: ${error instanceof Error ? error.message : String(error)}`);
      done(new UnauthorizedError("mTLS authentication failed"));
    }
  }
}
