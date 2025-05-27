import { fastifyAuth } from "@fastify/auth";
import { fastifyBasicAuth } from "@fastify/basic-auth";
import { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from "fastify";
import { PATH_CONSTANTS } from "src/constant.js";
import { createBasicAuthValidator } from "src/middleware/basicAuthValidation.js";
import { createSapCfMtlsHook } from "src/middleware/sapCfMtlsValidation.js";
import { OptAuthMethod } from "src/model/cli.js";
import { FastifyInstanceType } from "src/model/fastify.js";
import { UnauthorizedError } from "src/model/error/UnauthorizedError.js";
import { log } from "src/util/logger.js";
import { TLSSocket } from "tls";
import { tokenizeDn, dnTokensMatch, subjectToDn } from "src/util/certificateHelpers.js";

export interface AuthSetupOptions {
  authMethods: OptAuthMethod[];
  validUsers?: Record<string, string>;
  sapCfMtls?: {
    enabled: boolean;
    trustedIssuers?: string[];
    trustedSubjects?: string[];
    decodeBase64Headers?: boolean;
  };
  mtls?: {
    trustedIssuers?: string[];
    trustedSubjects?: string[];
  };
}

export async function setupAuthentication(server: FastifyInstanceType, options: AuthSetupOptions): Promise<void> {
  if (options.authMethods.includes(OptAuthMethod.Open)) {
    log.info("Authentication is disabled (open mode)");
    return;
  }

  await server.register(fastifyAuth);

  const authMethods = [];

  // Configure Basic Authentication if enabled
  if (options.authMethods.includes(OptAuthMethod.Basic) && options.validUsers) {
    log.info("Basic Authentication enabled");
    await server.register(fastifyBasicAuth, {
      validate: createBasicAuthValidator(options.validUsers),
      authenticate: true,
    });
    authMethods.push(server.basicAuth);
  }

  // Configure mTLS Authentication if enabled
  if (options.authMethods.includes(OptAuthMethod.MTLS)) {
    // Store authenticated flag in request for later use when combined with basic auth
    interface RequestWithAuth extends FastifyRequest {
      isMtlsAuthenticated?: boolean;
    }

    // Check if SAP CF mTLS mode is enabled
    if (options.sapCfMtls?.enabled) {
      log.info("SAP Cloud Foundry mTLS Authentication enabled");

      // Create SAP CF mTLS hook with configuration from environment
      const sapCfMtlsHook = createSapCfMtlsHook({
        trustedIssuers: options.sapCfMtls.trustedIssuers || [],
        trustedSubjects: options.sapCfMtls.trustedSubjects || [],
        decodeBase64Headers: options.sapCfMtls.decodeBase64Headers ?? true,
      });

      // Add SAP CF mTLS validation as onRequest hook
      server.addHook("onRequest", sapCfMtlsHook);
    } else {
      log.info("Standard mTLS Authentication enabled");

      // For standard mTLS, we add a modified onRequest hook that sets authentication flag
      server.addHook("onRequest", (request: RequestWithAuth, _: FastifyReply, done: HookHandlerDoneFunction) => {
        try {
          // Access the raw request from Node.js and check if it's a TLS connection
          const socket = request.raw.socket;

          if (!socket || !(socket instanceof TLSSocket)) {
            log.warn("mTLS authentication error: Not a TLS connection");
            // Don't fail the request yet, just mark as not authenticated via mTLS
            request.isMtlsAuthenticated = false;
            return done();
          }

          // Check if client certificate was provided and validated
          if (!socket.authorized) {
            log.warn(`mTLS authentication failed: Unauthorized client certificate`);
            request.isMtlsAuthenticated = false;
            return done();
          }

          // Get certificate information for logging/debugging
          const clientCert = socket.getPeerCertificate();
          if (clientCert && clientCert.subject) {
            const subject = clientCert.subject;
            log.debug(`mTLS authentication successful for: ${subject.CN || "Unknown"}`);
            log.debug(
              `Certificate details - Subject: ${JSON.stringify(subject)}, Issuer: ${JSON.stringify(clientCert.issuer)}, Valid: ${clientCert.valid_from} to ${clientCert.valid_to}`,
            );

            // Validate subject if trusted subjects are configured
            if (options.mtls?.trustedSubjects && options.mtls.trustedSubjects.length > 0) {
              const subjectDn = subjectToDn(subject);
              const subjectTokens = tokenizeDn(subjectDn);
              const isTrustedSubject = options.mtls.trustedSubjects.some((trustedSubject) => {
                const trustedTokens = tokenizeDn(trustedSubject);
                return dnTokensMatch(subjectTokens, trustedTokens);
              });

              if (!isTrustedSubject) {
                log.warn(`Standard mTLS: Certificate subject not trusted. Subject: ${subjectDn}`);
                // Mark as not authenticated via mTLS and continue (to allow basic auth)
                request.isMtlsAuthenticated = false;
                return done();
              }
            }

            // Validate issuer if trusted issuers are configured
            if (options.mtls?.trustedIssuers && options.mtls.trustedIssuers.length > 0 && clientCert.issuer) {
              const issuerDn = subjectToDn(clientCert.issuer);
              const issuerTokens = tokenizeDn(issuerDn);
              const isTrustedIssuer = options.mtls.trustedIssuers.some((trustedIssuer) => {
                const trustedTokens = tokenizeDn(trustedIssuer);
                return dnTokensMatch(issuerTokens, trustedTokens);
              });

              if (!isTrustedIssuer) {
                log.warn(`Standard mTLS: Certificate issuer not trusted. Issuer: ${issuerDn}`);
                // Mark as not authenticated via mTLS and continue (to allow basic auth)
                request.isMtlsAuthenticated = false;
                return done();
              }
            }
          }

          // Mark as authenticated via mTLS
          request.isMtlsAuthenticated = true;
          done();
        } catch (error) {
          log.error(`mTLS authentication error: ${error instanceof Error ? error.message : String(error)}`);
          request.isMtlsAuthenticated = false;
          done();
        }
      });
    }
  }

  // Set up the authentication hook
  if (authMethods.length > 0 || options.authMethods.includes(OptAuthMethod.MTLS)) {
    const authenticate = authMethods.length > 0 ? server.auth(authMethods, { relation: "or" }) : null;

    server.addHook(
      "onRequest",
      function (
        request: FastifyRequest & { isMtlsAuthenticated?: boolean },
        reply: FastifyReply,
        done: HookHandlerDoneFunction,
      ): void {
        if (
          request.url.startsWith(PATH_CONSTANTS.WELL_KNOWN_ENDPOINT) ||
          request.url.startsWith(PATH_CONSTANTS.STATUS_ENDPOINT)
        ) {
          done();
        } else if (request.isMtlsAuthenticated) {
          // If already authenticated via mTLS, allow the request
          done();
        } else if (authenticate) {
          // Otherwise, try basic auth if configured
          // @ts-expect-error request type matching
          authenticate(request, reply, done);
        } else {
          // If no authentication method succeeded, reject the request
          done(new UnauthorizedError("Authentication failed"));
        }
      },
    );
  }
}
