import { fastifyAuth } from "@fastify/auth";
import { fastifyBasicAuth } from "@fastify/basic-auth";
import { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from "fastify";
import { PATH_CONSTANTS } from "src/constant.js";
import { createBasicAuthValidator } from "src/middleware/basicAuthValidation.js";
import { createSapCfMtlsHook } from "src/middleware/sapCfMtlsValidation.js";
import { OptAuthMethod } from "src/model/cli.js";
import { FastifyInstanceType } from "src/model/fastify.js";
import { log } from "src/util/logger.js";
import { getCertificateLoader } from "src/services/certificateLoader.js";
import { UnauthorizedError } from "src/model/error/UnauthorizedError.js";

// Extend Fastify instance to include mtlsAuth method
declare module "fastify" {
  export interface FastifyInstance {
    mtlsAuth: (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void;
  }
}

export interface AuthSetupOptions {
  authMethods: OptAuthMethod[];
  validUsers?: Record<string, string>;
  sapCfMtls?: {
    enabled: boolean;
    trustedIssuers?: string[];
    trustedSubjects?: string[];
    decodeBase64Headers?: boolean;
    caChainFilePath?: string;
  };
}

export async function setupAuthentication(server: FastifyInstanceType, options: AuthSetupOptions): Promise<void> {
  if (options.authMethods.includes(OptAuthMethod.Open)) {
    log.info("Authentication is disabled (open mode)");
    return;
  }

  // Initialize certificate loader if SAP CF mTLS is enabled
  if (options.authMethods.includes(OptAuthMethod.MTLS) && options.sapCfMtls?.enabled) {
    try {
      log.info("Initializing certificate loader for mTLS validation...");
      await getCertificateLoader(options.sapCfMtls.caChainFilePath);
      log.info("Certificate loader initialized successfully");
    } catch (error) {
      log.error(`Failed to initialize certificate loader: ${error instanceof Error ? error.message : String(error)}`);
      // Continue without full validation - basic header checks will still work
    }
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
    if (!options.sapCfMtls?.enabled) {
      throw new Error("Only SAP CF mTLS mode is supported. Standard mTLS mode has been removed.");
    }

    log.info("SAP Cloud Foundry mTLS Authentication enabled");

    // Create SAP CF mTLS hook with configuration from environment
    const sapCfMtlsHook = createSapCfMtlsHook({
      trustedIssuers: options.sapCfMtls.trustedIssuers || [],
      trustedSubjects: options.sapCfMtls.trustedSubjects || [],
      decodeBase64Headers: options.sapCfMtls.decodeBase64Headers ?? true,
      caChainFilePath: options.sapCfMtls.caChainFilePath,
    });

    // Add SAP CF mTLS validation as onRequest hook
    server.addHook("onRequest", sapCfMtlsHook);

    // Create mTLS authentication method for Fastify auth
    server.decorate(
      "mtlsAuth",
      function (request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) {
        if (request.isMtlsAuthenticated) {
          done();
        } else {
          done(new UnauthorizedError("mTLS authentication required"));
        }
      },
    );

    authMethods.push(server.mtlsAuth);
  }

  // Set up the authentication hook
  if (authMethods.length > 0) {
    const authenticate = server.auth(authMethods, { relation: "or" });

    server.addHook(
      "onRequest",
      function (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void {
        if (
          request.url.startsWith(PATH_CONSTANTS.WEBHOOK_ENDPOINT) ||
          request.url.startsWith(PATH_CONSTANTS.WELL_KNOWN_ENDPOINT)
        ) {
          done();
        } else {
          // @ts-expect-error request type matching
          authenticate(request, reply, done);
        }
      },
    );
  }
}
