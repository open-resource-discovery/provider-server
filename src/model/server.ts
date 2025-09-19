import { log } from "src/util/logger.js";
import { CommandLineOptions, OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { getBaseUrl as updateBaseUrl } from "src/util/ordConfig.js";
import { normalizePath } from "src/util/pathUtils.js";
import { trimLeadingAndTrailingSlashes, trimTrailingSlash } from "src/util/optsValidation.js";

export interface ProviderServerOptions {
  ordDirectory: string;
  ordDocumentsSubDirectory: string;
  baseUrl?: string;
  host?: string;
  port?: number;
  sourceType: OptSourceType;
  githubBranch?: string;
  githubApiUrl?: string;
  githubRepository?: string;
  githubToken?: string;
  authentication: {
    methods: OptAuthMethod[];
    basicAuthUsers?: Record<string, string>;
  };
  dataDir: string;
  cors?: string[];
  webhookSecret?: string;
  updateDelay: number;
  statusDashboardEnabled: boolean;
}

function parseOrdDirectory(ordDirectory: string | undefined, sourceType: OptSourceType): string {
  ordDirectory = ordDirectory !== undefined ? ordDirectory : process.env.ORD_DIRECTORY || "";

  if (sourceType === OptSourceType.Github) {
    ordDirectory = trimLeadingAndTrailingSlashes(normalizePath(ordDirectory));
    if (ordDirectory === undefined || ordDirectory.trim() === "") {
      ordDirectory = ".";
    }
  } else {
    // For local paths, just normalize
    ordDirectory = normalizePath(ordDirectory);
  }

  return ordDirectory;
}

export function buildProviderServerOptions(options: CommandLineOptions): ProviderServerOptions {
  log.info("Building server configuration...");

  return {
    ordDirectory: parseOrdDirectory(options.directory, options.sourceType),
    ordDocumentsSubDirectory: trimLeadingAndTrailingSlashes(options.documentsSubdirectory) || "", // Ensure it's never undefined
    baseUrl: updateBaseUrl(options.baseUrl),
    host: trimTrailingSlash(options.host),
    port: options.port ? parseInt(options.port) : undefined,
    sourceType: options.sourceType,
    githubApiUrl: trimTrailingSlash(options.githubApiUrl),
    githubRepository: options.githubRepository,
    githubBranch: options.githubBranch,
    githubToken: options.githubToken,
    authentication: {
      methods: options.auth,
      basicAuthUsers: options.auth.includes(OptAuthMethod.Basic) ? JSON.parse(process.env.BASIC_AUTH!) : undefined,
    },
    dataDir: options.dataDir || "./data",
    cors: options.cors ? options.cors.split(",") : undefined,
    webhookSecret: process.env.WEBHOOK_SECRET,
    updateDelay: (parseInt(options.updateDelay as string) || 30) * 1000, // Convert seconds to milliseconds
    statusDashboardEnabled: options.statusDashboardEnabled?.toLowerCase() !== "false", // Default to true
  };
}
