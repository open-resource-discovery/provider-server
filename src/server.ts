import fastifyETag from "@fastify/etag";
import fastify from "fastify";
import { WELL_KNOWN_ENDPOINT } from "src/constant.js";
import { setupAuthentication } from "src/middleware/authenticationSetup.js";
import { errorHandler } from "src/middleware/errorHandler.js";
import { OptSourceType } from "src/model/cli.js";
import { type FastifyInstanceType } from "src/model/fastify.js";
import { GithubOpts } from "src/model/github.js";
import { type ProviderServerOptions } from "src/model/server.js";
import { GithubRouter } from "src/routes/githubRouter.js";
import { LocalRouter } from "src/routes/localRouter.js";
import { log } from "src/util/logger.js";
import { createOrdConfigGetter, emptyOrdConfig } from "src/util/ordConfig.js";
import { OrdDocumentProcessor, ProcessingContext } from "./services/ordProcessorService.js";
import { getFlattenedOrdFqnDocumentMap } from "./util/fqnHelpers.js";

export { ProviderServerOptions }; // Re-export the type

type ShutdownFunction = () => Promise<void>;

export async function startProviderServer(opts: ProviderServerOptions): Promise<ShutdownFunction> {
  log.info("============================================================");
  log.info("ORD Provider Server");
  log.info("============================================================");

  const server = fastify({
    loggerInstance: log,
    ignoreTrailingSlash: true,
    exposeHeadRoutes: true,
  });

  // Basic server setup
  await setupServer(server);

  // Setup authentication
  await setupAuthentication(server, {
    authMethods: opts.authentication.methods,
    validUsers: opts.authentication.basicAuthUsers,
  });

  // Configure routing based on source type
  await setupRouting(server, opts);

  // Start server
  return await startServer(server, opts);
}

async function setupServer(server: FastifyInstanceType): Promise<void> {
  server.setErrorHandler(errorHandler);
  await server.register(fastifyETag);
}

async function setupRouting(server: FastifyInstanceType, opts: ProviderServerOptions): Promise<void> {
  const baseUrl = opts.baseUrl!;

  if (opts.sourceType === OptSourceType.Local) {
    const ordConfig = emptyOrdConfig(baseUrl);

    const localContext: ProcessingContext = {
      baseUrl: baseUrl,
      authMethods: opts.authentication.methods,
    };

    const ordDocuments = OrdDocumentProcessor.processLocalDocuments(localContext, ordConfig, opts.ordDirectory);
    const fqnDocumentMap = getFlattenedOrdFqnDocumentMap(Object.values(ordDocuments));

    const ordConfigGetter = createOrdConfigGetter({
      authMethods: opts.authentication.methods,
      sourceType: OptSourceType.Local,
      ordConfig,
      baseUrl,
    });

    const localRouter = new LocalRouter({
      authMethods: opts.authentication.methods,
      baseUrl,
      ordDirectory: opts.ordDirectory,
      ordDocuments,
      ordConfig: ordConfigGetter,
      fqnDocumentMap,
    });

    await localRouter.register(server);

    OrdDocumentProcessor.registerLocalUpdateHandler(localContext, ordConfig, opts.ordDirectory, (ordDocuments) => {
      const fqnDocumentMap = getFlattenedOrdFqnDocumentMap(Object.values(ordDocuments));

      localRouter.updateConfig({
        authMethods: opts.authentication.methods,
        baseUrl,
        ordDirectory: opts.ordDirectory,
        ordDocuments,
        ordConfig: ordConfigGetter,
        fqnDocumentMap,
      });
    });
  } else if (opts.sourceType === OptSourceType.Github) {
    const githubOpts: GithubOpts = {
      githubApiUrl: opts.githubApiUrl!,
      githubRepository: opts.githubRepository!,
      githubBranch: opts.githubBranch!,
      githubToken: opts.githubToken,
      customDirectory: opts.ordDirectory,
    };

    const ordConfigGetter = createOrdConfigGetter({
      authMethods: opts.authentication.methods,
      sourceType: OptSourceType.Github,
      githubOpts,
      baseUrl,
    });

    const { fqnDocumentMap } = await OrdDocumentProcessor.preprocessGithubDocuments(
      githubOpts,
      baseUrl,
      opts.authentication.methods,
    );

    const githubRouter = new GithubRouter({
      ...githubOpts,
      authMethods: opts.authentication.methods,
      baseUrl,
      fqnDocumentMap,
      ordConfig: ordConfigGetter,
    });

    await githubRouter.register(server);
  }
}

async function startServer(server: FastifyInstanceType, opts: ProviderServerOptions): Promise<ShutdownFunction> {
  try {
    const port = opts.port || 8080;
    const host = opts.host || "0.0.0.0";

    const serverEndpoint = await server.listen({
      port,
      host,
    });

    server.log.info(`Server started on port ${port}`);
    server.log.info(`ORD entry-point available: ${serverEndpoint}${WELL_KNOWN_ENDPOINT}`);

    // Return the shutdown function
    return async () => {
      try {
        await server.close();
        server.log.info("Server shutdown complete");
      } catch (err) {
        server.log.error("Error during server shutdown:", err);
        throw err;
      }
    };
  } catch (err) {
    process.stdout.write(`Error: ${String(err)}`);
    process.exit(1);
  }
}
