import { log } from "src/util/logger.js";
import { CommandLineOptions, OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { getBaseUrl as updateBaseUrl } from "src/util/ordConfig.js";
import { config } from "dotenv";
config();

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
}

function parseOrdDirectory(ordDirectory: string | undefined, sourceType: OptSourceType): string {
  ordDirectory = ordDirectory !== undefined ? ordDirectory : process.env.ORD_DIRECTORY || "";
  if (ordDirectory?.startsWith("/") && sourceType === OptSourceType.Github) {
    ordDirectory = ordDirectory.replace("/", "");
  }

  return ordDirectory;
}

export function buildProviderServerOptions(options: CommandLineOptions): ProviderServerOptions {
  log.info("Building server configuration...");
  return {
    ordDirectory: parseOrdDirectory(options.directory, options.sourceType),
    ordDocumentsSubDirectory: options.documentsSubdirectory || "documents",
    baseUrl: updateBaseUrl(options.baseUrl),
    host: options.host,
    port: options.port ? parseInt(options.port) : undefined,
    sourceType: options.sourceType,
    githubApiUrl: options.githubApiUrl || process.env.GITHUB_API_URL,
    githubRepository: options.githubRepository || process.env.GITHUB_REPOSITORY,
    githubBranch: options.githubBranch || process.env.GITHUB_BRANCH,
    githubToken: options.githubToken || process.env.GITHUB_TOKEN,
    authentication: {
      methods: options.auth,
      basicAuthUsers: options.auth.includes(OptAuthMethod.Basic) ? JSON.parse(process.env.BASIC_AUTH!) : undefined,
    },
  };
}
