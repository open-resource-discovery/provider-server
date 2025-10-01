import fastifyETag from "@fastify/etag";
import fastifyWebsocket from "@fastify/websocket";
import fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import statusRouter from "./routes/statusRouter.js";
import { PATH_CONSTANTS } from "src/constant.js";
import { setupAuthentication } from "src/middleware/authenticationSetup.js";
import { errorHandler } from "src/middleware/errorHandler.js";
import { OptSourceType } from "src/model/cli.js";
import { type FastifyInstanceType } from "src/model/fastify.js";
import { type ProviderServerOptions } from "src/model/server.js";
import { log } from "src/util/logger.js";
import { RouterFactory } from "./factories/routerFactory.js";
import { FileSystemManager } from "./services/fileSystemManager.js";
import { GitCloneContentFetcher } from "./services/gitCloneContentFetcher.js";
import { UpdateScheduler } from "./services/updateScheduler.js";
import { WebhookRouter } from "./routes/webhookRouter.js";
import { StatusWebSocketHandler } from "./websocket/statusWebSocketHandler.js";
import { StatusService } from "./services/statusService.js";
import { buildGithubConfig } from "./model/github.js";
import { LocalDocumentRepository } from "./repositories/localDocumentRepository.js";
import { getPackageVersion } from "./util/files.js";
import { initializeGitSource } from "./util/gitInitializer.js";
import cors from "@fastify/cors";
import { UpdateStateManager } from "./services/updateStateManager.js";
import { createReadinessGate } from "./middleware/readinessGate.js";

const version = getPackageVersion();

export { ProviderServerOptions }; // Re-export the type

type ShutdownFunction = () => Promise<void>;

let fileSystemManager: FileSystemManager | null = null;
let updateScheduler: UpdateScheduler | null = null;
let updateStateManager: UpdateStateManager | null = null;

export async function startProviderServer(opts: ProviderServerOptions): Promise<ShutdownFunction> {
  log.info("============================================================");
  log.info("ORD Provider Server");
  log.info("============================================================");

  const server = fastify({
    loggerInstance: log,
    exposeHeadRoutes: true,
    routerOptions: {
      ignoreTrailingSlash: true,
    },
  });

  if (opts.cors) {
    server.register(cors, {
      origin: opts.cors,
    });
  }

  // Initialize update state manager
  updateStateManager = new UpdateStateManager(log);

  // Initialize file system manager
  fileSystemManager = new FileSystemManager({
    dataDir: opts.dataDir,
    documentsSubDirectory: opts.ordDocumentsSubDirectory,
  });
  await fileSystemManager.initialize();

  if (opts.sourceType === OptSourceType.Github) {
    // Create the update scheduler but don't perform initial sync yet
    const githubConfig = buildGithubConfig({
      apiUrl: opts.githubApiUrl!,
      repository: opts.githubRepository!,
      branch: opts.githubBranch!,
      token: opts.githubToken,
      rootDirectory: opts.ordDirectory,
    });

    const contentFetcher = new GitCloneContentFetcher(githubConfig);

    updateScheduler = new UpdateScheduler(
      {
        updateDelay: opts.updateDelay,
      },
      contentFetcher,
      fileSystemManager,
      log,
      updateStateManager,
    );

    // Initialize the scheduler to load metadata
    await updateScheduler.initialize();
  }

  // Basic server setup
  await setupServer(server, opts);

  // Setup authentication
  await setupAuthentication(server, {
    authMethods: opts.authentication.methods,
    validUsers: opts.authentication.basicAuthUsers,
  });

  // Setup readiness gate for GitHub source type
  // This holds requests during git clone/pull operations to prevent 404s
  if (opts.sourceType === OptSourceType.Github && updateStateManager) {
    server.addHook("onRequest", createReadinessGate(updateStateManager));
  }

  // Configure routing based on source type
  await setupRouting(server, opts);

  // Setup webhook endpoint if using GitHub
  if (opts.sourceType === OptSourceType.Github && updateScheduler) {
    const webhookRouter = new WebhookRouter(
      updateScheduler,
      {
        secret: opts.webhookSecret,
        branch: opts.githubBranch!,
        repository: opts.githubRepository!,
      },
      log,
    );
    webhookRouter.register(server);
  }

  const shutdown = await startServer(server, opts);

  // For GitHub source, perform online validation after server has started
  if (opts.sourceType === OptSourceType.Github && fileSystemManager) {
    performOnlineValidation(opts, fileSystemManager).catch((error) => {
      log.error("Background online validation failed:", error);
    });
  }

  return shutdown;
}

async function performOnlineValidation(
  opts: ProviderServerOptions,
  fileSystemManager: FileSystemManager,
): Promise<void> {
  log.info("Starting online validation and content synchronization...");

  try {
    if (updateScheduler) {
      updateScheduler.notifyUpdateStarted();
    }

    // Initialize git source - this will clone and validate the GitHub repository
    const validationResult = await initializeGitSource(opts, fileSystemManager, updateStateManager!);

    if (validationResult.contentAvailable) {
      log.info("Online validation complete. Content is now available.");

      // Notify the repository that content is now available by recreating it
      // This will update the directoryExists flag
      const currentPath = fileSystemManager.getCurrentPath();
      new LocalDocumentRepository(currentPath);

      if (updateScheduler) {
        updateScheduler.notifyUpdateCompleted();
      }
    }
  } catch (error) {
    log.error("Online validation failed: %s", error);
    if (updateScheduler) {
      updateScheduler.notifyUpdateFailed(error);
    }
  }
}

async function setupServer(server: FastifyInstanceType, opts: ProviderServerOptions): Promise<void> {
  server.setErrorHandler(errorHandler);

  await server.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
  });
  await server.register(fastifyETag);

  await server.register(fastifyWebsocket);

  let localRepository: LocalDocumentRepository | null = null;
  if (opts.sourceType === OptSourceType.Local) {
    localRepository = new LocalDocumentRepository(opts.ordDirectory);
  }

  const statusService = new StatusService(
    updateScheduler,
    fileSystemManager,
    log,
    opts,
    localRepository,
    updateStateManager,
  );
  const wsHandler = new StatusWebSocketHandler(statusService, updateScheduler, log, updateStateManager);
  // @ts-expect-error Type mismatch between Fastify instance types
  wsHandler.register(server);

  // Register status router with enhanced functionality
  await server.register(statusRouter, {
    fileSystemManager,
    updateScheduler,
    statusDashboardEnabled: opts.statusDashboardEnabled,
    statusService,
  });

  // Add root redirect based on status dashboard setting
  server.get("/", (_request, reply) => {
    if (opts.statusDashboardEnabled) {
      reply.redirect("/status");
    } else {
      reply.redirect(PATH_CONSTANTS.WELL_KNOWN_ENDPOINT);
    }
  });

  // Add health check endpoint
  server.get("/health", { logLevel: "error" }, async (_request, _reply) => {
    const currentVersion = await fileSystemManager?.getCurrentVersion();
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      version,
      sync: {
        hasContent: opts.sourceType !== OptSourceType.Github || !!currentVersion,
      },
    };
  });

  // Add version header to all responses
  server.addHook("onSend", (_request, reply, _, done) => {
    reply.header("x-ord-provider-server-version", version);
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
  log.info(`>> Data Directory: ${opts.dataDir}`);
  log.info(`>> Update Delay (Webhook Cooldown): ${opts.updateDelay / 1000}s`);
  if (opts.authentication?.methods) {
    log.info(`>> Authentication Methods: ${opts.authentication.methods.join(", ")}`);
  }
  if (opts.authentication?.basicAuthUsers) {
    log.info(
      `>> Authentication Basic Auth Users: ${Object.entries(opts.authentication.basicAuthUsers).map(([userName, password]) => `${userName}${password ? " ***" : ""}`)}`,
    );
  }

  // For GitHub source, use the current version directory
  const effectiveOrdDirectory =
    opts.sourceType === OptSourceType.Github ? fileSystemManager!.getCurrentPath() : opts.ordDirectory;

  const router = await RouterFactory.createRouter({
    sourceType: opts.sourceType,
    baseUrl: baseUrl,
    authMethods: opts.authentication.methods,
    fqnDocumentMap: {},
    documentsSubDirectory: opts.ordDocumentsSubDirectory,
    ordDirectory: effectiveOrdDirectory,
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
    fileSystemManager: fileSystemManager || undefined,
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
        if (updateScheduler) {
          server.log.info("Stopping update scheduler...");
          updateScheduler.stop();
        }

        await server.close();
        server.log.info("Server shutdown complete");
      } catch (err) {
        server.log.error(`Error during server shutdown: ${err}`);
        throw err;
      }
    };
  } catch (err) {
    process.stdout.write(`Error: ${String(err)}`);
    process.exit(1);
  }
}
