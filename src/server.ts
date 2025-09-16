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
import { FqnDocumentMap } from "./util/fqnHelpers.js";
import { FileSystemManager } from "./services/fileSystemManager.js";
import { GithubContentFetcher } from "./services/githubContentFetcher.js";
import { UpdateScheduler } from "./services/updateScheduler.js";
import { WebhookRouter } from "./routes/webhookRouter.js";
import { StatusWebSocketHandler } from "./websocket/statusWebSocketHandler.js";
import { StatusService } from "./services/statusService.js";
import { buildGithubConfig } from "./model/github.js";
import { LocalDocumentRepository } from "./repositories/localDocumentRepository.js";
import { getPackageVersion } from "./util/files.js";

const version = getPackageVersion();

export { ProviderServerOptions }; // Re-export the type

type ShutdownFunction = () => Promise<void>;

let fileSystemManager: FileSystemManager | null = null;
let updateScheduler: UpdateScheduler | null = null;

export async function startProviderServer(opts: ProviderServerOptions): Promise<ShutdownFunction> {
  log.info("============================================================");
  log.info("ORD Provider Server");
  log.info("============================================================");

  const server = fastify({
    loggerInstance: log,
    ignoreTrailingSlash: true,
    exposeHeadRoutes: true,
  });

  // Initialize file system manager
  fileSystemManager = new FileSystemManager({
    dataDir: opts.dataDir,
    documentsSubDirectory: opts.ordDocumentsSubDirectory,
  });
  await fileSystemManager.initialize();

  // Perform warm-up if using GitHub source
  if (opts.sourceType === OptSourceType.Github) {
    await performWarmup(opts);
  }

  // Basic server setup
  await setupServer(server, opts);

  // Setup authentication
  await setupAuthentication(server, {
    authMethods: opts.authentication.methods,
    validUsers: opts.authentication.basicAuthUsers,
  });

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

  return await startServer(server, opts);
}

async function performWarmup(opts: ProviderServerOptions): Promise<void> {
  log.info("Performing server warm-up...");

  const githubConfig = buildGithubConfig({
    apiUrl: opts.githubApiUrl!,
    repository: opts.githubRepository!,
    branch: opts.githubBranch!,
    token: opts.githubToken,
    rootDirectory: opts.ordDirectory,
  });

  const contentFetcher = new GithubContentFetcher(githubConfig);

  updateScheduler = new UpdateScheduler(
    {
      updateDelay: opts.updateDelay,
    },
    contentFetcher,
    fileSystemManager!,
    log,
  );

  // Initialize the scheduler to load metadata
  await updateScheduler.initialize();

  // Check if we have a current version
  const currentVersion = await fileSystemManager!.getCurrentVersion();

  if (!currentVersion) {
    log.info("No current version found. Fetching initial content from GitHub...");

    try {
      await updateScheduler.forceUpdate();
      log.info("Initial content fetch completed successfully");
    } catch (error) {
      log.fatal("Failed to fetch initial content from GitHub: %s", error);
      throw error;
    }
  } else {
    log.info(`Found existing version: ${currentVersion}`);

    const needsUpdate = await updateScheduler.checkForUpdates();

    if (needsUpdate) {
      try {
        await updateScheduler.forceUpdate();
        log.info("Content update completed successfully");
      } catch (error) {
        log.error("Failed to update content from GitHub: %s", error);
        log.warn("Continuing with existing cached content");
      }
    } else {
      log.info("Local content is up to date with GitHub");
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

  const statusService = new StatusService(updateScheduler, fileSystemManager, log, opts, localRepository);
  const wsHandler = new StatusWebSocketHandler(statusService, updateScheduler, log);
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
  server.get("/health", { logLevel: "error" }, (_request, _reply) => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      version,
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

  const initialFqnDocumentMap: FqnDocumentMap = {};

  // For GitHub source, always use local filesystem with the current version directory
  const effectiveOrdDirectory =
    opts.sourceType === OptSourceType.Github ? fileSystemManager!.getCurrentPath() : opts.ordDirectory;

  const router = await RouterFactory.createRouter({
    sourceType: OptSourceType.Local, // Always use local mode now
    baseUrl: baseUrl,
    authMethods: opts.authentication.methods,
    fqnDocumentMap: initialFqnDocumentMap,
    documentsSubDirectory: opts.ordDocumentsSubDirectory,
    ordDirectory: effectiveOrdDirectory,
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
        server.log.error(`Error during server shutdown: ${err}`);
        throw err;
      }
    };
  } catch (err) {
    process.stdout.write(`Error: ${String(err)}`);
    process.exit(1);
  }
}
