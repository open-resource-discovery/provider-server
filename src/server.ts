import fastifyETag from "@fastify/etag";
import fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import statusRouter from "./routes/statusRouter.js";
import { PATH_CONSTANTS } from "src/constant.js";
import { setupAuthentication } from "src/middleware/authenticationSetup.js";
import { errorHandler } from "src/middleware/errorHandler.js";
import { OptSourceType } from "src/model/cli.js";
import { type FastifyInstanceType } from "src/model/fastify.js";
import { type ProviderServerOptions } from "src/model/server.js";
import { log } from "src/util/logger.js";
import { RouterFactory } from "./factories/routerFactory.js";
import { FqnDocumentMap } from "./util/fqnHelpers.js";

// Helper to get package.json version
function getPackageVersion(): string {
  try {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJsonContent = fs.readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.version || "unknown";
  } catch (error) {
    log.error("Failed to read package.json version:", error);
    return "unknown";
  }
}

const version = getPackageVersion();

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

  return await startServer(server, opts);
}

async function setupServer(server: FastifyInstanceType): Promise<void> {
  server.setErrorHandler(errorHandler);
  await server.register(fastifyETag);

  // Register status router
  await server.register(statusRouter);

  // Add version header to all responses
  server.addHook("onSend", (_request, reply, _, done) => {
    reply.header("x-provider-server-version", version);
    done();
  });
}

async function setupRouting(server: FastifyInstanceType, opts: ProviderServerOptions): Promise<void> {
  const baseUrl = opts.baseUrl!;

  log.info(`Starting with options`);
  log.info(`>> Source Type: ${opts.sourceType}`);
  log.info(`>> Base URL: ${opts.baseUrl || "-"}`);
  log.info(
    `>> ORD Document Directory: ${opts.ordDirectory || opts.sourceType === "github" ? PATH_CONSTANTS.GITHUB_DEFAULT_ROOT : ""}/${opts.ordDocumentsSubDirectory}`,
  );
  log.info(`>> Host: ${opts.host || "-"}`);
  log.info(`>> Port: ${opts.port || "-"}`);
  log.info(`>> GitHub API URL: ${opts.githubApiUrl || "-"}`);
  log.info(`>> GitHub Repository: ${opts.githubRepository || "-"}`);
  log.info(`>> GitHub Branch: ${opts.githubBranch || "-"}`);
  log.info(`>> GitHub Token: ${opts.githubToken?.slice(-4).padStart(opts.githubToken.length, "*") || "-"}`);
  if (opts.authentication?.methods) {
    log.info(`>> Authentication Methods: ${opts.authentication.methods.join(", ")}`);
  }
  if (opts.authentication?.basicAuthUsers) {
    log.info(
      `>> Authentication Basic Auth Users: ${Object.entries(opts.authentication.basicAuthUsers).map(([userName, password]) => `${userName}${password ? " ***" : ""}`)}`,
    );
  }

  // FQN map generation is now handled within the DocumentService,
  // triggered by the RouterFactory when creating the service instance.
  // We still need to pass an initial (empty) map to the factory options,
  // as the factory passes it down, but the *real* map used by the router
  // will be the one generated and retrieved by the factory from the service.
  const initialFqnDocumentMap: FqnDocumentMap = {};

  const router = await RouterFactory.createRouter({
    sourceType: opts.sourceType,
    baseUrl: baseUrl,
    authMethods: opts.authentication.methods,
    fqnDocumentMap: initialFqnDocumentMap,
    documentsSubDirectory: opts.ordDocumentsSubDirectory,
    githubOpts:
      opts.sourceType === OptSourceType.Github
        ? {
            githubApiUrl: opts.githubApiUrl!,
            githubRepository: opts.githubRepository!,
            githubBranch: opts.githubBranch!,
            githubToken: opts.githubToken,
            customDirectory: opts.ordDirectory,
          }
        : undefined,
    ordDirectory: opts.sourceType === OptSourceType.Local ? opts.ordDirectory : undefined,
  });

  router.register(server);
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
    server.log.info(`(Local Server) ORD entry-point available: ${serverEndpoint}${PATH_CONSTANTS.WELL_KNOWN_ENDPOINT}`);
    if (opts.baseUrl) {
      server.log.info(`(Base URL) ORD entry-point available: ${opts.baseUrl}${PATH_CONSTANTS.WELL_KNOWN_ENDPOINT}`);
    }

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
