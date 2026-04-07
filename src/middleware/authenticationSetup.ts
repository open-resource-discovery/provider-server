import { fastifyAuth } from "@fastify/auth";
import { fastifyBasicAuth } from "@fastify/basic-auth";
import { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from "fastify";
import { PATH_CONSTANTS } from "src/constant.js";
import { createBasicAuthValidator } from "src/middleware/basicAuthValidation.js";
import { createSapCfMtlsValidator } from "src/middleware/sapCfMtlsValidation.js";
import { OptAuthMethod } from "src/model/cli.js";
import { FastifyInstanceType } from "src/model/fastify.js";
import { fetchMtlsTrustedCertsFromEndpoints, mergeTrustedCerts } from "src/services/mtlsEndpointService.js";
import { log } from "src/util/logger.js";
import { createSapKymaMtlsValidator } from "src/middleware/sapKymaMtlsValidation.js";

export interface AuthSetupOptions {
  authMethods: OptAuthMethod[];
  validUsers?: Record<string, string>;
  trustedCerts?: { issuer: string; subject: string }[];
  trustedRootCaDns?: string[];
  mtlsConfigEndpoints?: string[];
}

export async function setupAuthentication(server: FastifyInstanceType, options: AuthSetupOptions): Promise<void> {
  if (options.authMethods.includes(OptAuthMethod.Open)) {
    return;
  }

  await server.register(fastifyAuth);

  const authMethods: ((request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void)[] = [];

  if (options.authMethods.includes(OptAuthMethod.Basic) && options.validUsers) {
    await server.register(fastifyBasicAuth, {
      validate: createBasicAuthValidator(options.validUsers),
      authenticate: true,
    });
    authMethods.push(server.basicAuth);
  }

  if (options.authMethods.includes(OptAuthMethod.CfMtls)) {
    let trustedCerts = options.trustedCerts || [];
    let trustedRootCaDns = options.trustedRootCaDns || [];

    if (options.mtlsConfigEndpoints && options.mtlsConfigEndpoints.length > 0) {
      log.info(`Fetching mTLS trusted certificates from ${options.mtlsConfigEndpoints.length} endpoint(s)...`);
      const fromEndpoints = await fetchMtlsTrustedCertsFromEndpoints(options.mtlsConfigEndpoints);

      const merged = mergeTrustedCerts(fromEndpoints, {
        trustedCerts,
        trustedRootCaDns,
      });

      trustedCerts = merged.trustedCerts;
      trustedRootCaDns = merged.trustedRootCaDns;

      log.info(
        `Loaded ${trustedCerts.length} trusted certificate pair(s) and ${trustedRootCaDns.length} trusted root CA DN(s)`,
      );
    }

    if (trustedCerts.length === 0 && trustedRootCaDns.length === 0) {
      log.error("mTLS authentication enabled but no trusted certificate pairs or root CA DNs configured");
      throw new Error("mTLS authentication misconfiguration");
    }

    const mtlsValidator = createSapCfMtlsValidator({
      trustedCerts,
      trustedRootCaDns,
    });

    authMethods.push(mtlsValidator);
  }

  if (options.authMethods.includes(OptAuthMethod.KymaMtls)) {
    let trustedCerts = options.trustedCerts || [];

    if (options.mtlsConfigEndpoints && options.mtlsConfigEndpoints.length > 0) {
      log.info(`Fetching mTLS trusted certificates from ${options.mtlsConfigEndpoints.length} endpoint(s)...`);
      const fromEndpoints = await fetchMtlsTrustedCertsFromEndpoints(options.mtlsConfigEndpoints);

      trustedCerts = mergeTrustedCerts(fromEndpoints, { trustedCerts, trustedRootCaDns: [] }).trustedCerts;

      log.info(`Loaded ${trustedCerts.length} trusted certificate pair(s)`);
    }

    if (trustedCerts.length === 0) {
      log.error("mTLS authentication enabled but no trusted certificate pairs configured");
      throw new Error("mTLS authentication misconfiguration");
    }

    authMethods.push(createSapKymaMtlsValidator({ trustedCerts }));
  }

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
