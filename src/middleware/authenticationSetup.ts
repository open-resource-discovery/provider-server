import { fastifyAuth } from "@fastify/auth";
import { fastifyBasicAuth } from "@fastify/basic-auth";
import { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from "fastify";
import { PATH_CONSTANTS } from "src/constant.js";
import { createBasicAuthValidator } from "src/middleware/basicAuthValidation.js";
import { OptAuthMethod } from "src/model/cli.js";
import { FastifyInstanceType } from "src/model/fastify.js";

export interface AuthSetupOptions {
  authMethods: OptAuthMethod[];
  validUsers?: Record<string, string>;
}

export async function setupAuthentication(server: FastifyInstanceType, options: AuthSetupOptions): Promise<void> {
  if (options.authMethods.includes(OptAuthMethod.Open)) {
    return;
  }

  await server.register(fastifyAuth);

  const authMethods = [];
  if (options.authMethods.includes(OptAuthMethod.Basic) && options.validUsers) {
    await server.register(fastifyBasicAuth, {
      validate: createBasicAuthValidator(options.validUsers),
      authenticate: true,
    });
    authMethods.push(server.basicAuth);
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
