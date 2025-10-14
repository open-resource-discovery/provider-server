import { log } from "src/util/logger.js";
import { CommandLineOptions, OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { getBaseUrl as updateBaseUrl } from "src/util/ordConfig.js";
import { normalizePath, trimLeadingAndTrailingSlashes, trimTrailingSlash } from "src/util/pathUtils.js";
import { config } from "dotenv";
import { MtlsMode } from "../constant.js";
import { fetchMtlsTrustedCertsFromEndpoints, mergeTrustedCerts } from "../services/mtlsEndpointService.js";
import { ValidationError } from "./error/ValidationError.js";

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
    sapCfMtls?: {
      enabled: boolean;
      trustedIssuers?: string[];
      trustedSubjects?: string[];
      decodeBase64Headers?: boolean;
      caChainFilePath?: string;
    };
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

export async function buildProviderServerOptions(options: CommandLineOptions): Promise<ProviderServerOptions> {
  log.info("Building server configuration...");

  const providerOpts: ProviderServerOptions = {
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

  if (options.auth.includes(OptAuthMethod.MTLS)) {
    // Only SAP CF mTLS mode is supported
    const mtlsMode = options.mtlsMode || MtlsMode.SapCmpMtls;

    if (mtlsMode !== MtlsMode.SapCmpMtls) {
      throw ValidationError.fromErrors(["Only 'sap:cmp-mtls' mode is supported. Standard mTLS mode has been removed."]);
    }

    // SAP CF mTLS mode - parse configured trusted issuers and subjects
    const configuredTrustedCerts = {
      trustedIssuers: options.mtlsTrustedIssuers?.split(";") || undefined,
      trustedSubjects: options.mtlsTrustedSubjects?.split(";") || undefined,
    };

    let finalTrustedIssuers = configuredTrustedCerts.trustedIssuers;
    let finalTrustedSubjects = configuredTrustedCerts.trustedSubjects;

    // Fetch from endpoints if configured
    const configEndpoints = options.mtlsConfigEndpoints || process.env.MTLS_CONFIG_ENDPOINTS;
    if (configEndpoints) {
      const endpoints = configEndpoints.split(";").filter((e) => e.trim());
      if (endpoints.length > 0) {
        log.info(`SAP CF mTLS: Fetching trusted certificates from ${endpoints.length} endpoints...`);
        try {
          const endpointCerts = await fetchMtlsTrustedCertsFromEndpoints(endpoints);
          const mergedCerts = mergeTrustedCerts(endpointCerts, configuredTrustedCerts);

          finalTrustedIssuers = mergedCerts.trustedIssuers;
          finalTrustedSubjects = mergedCerts.trustedSubjects;

          log.info(
            `SAP CF mTLS: Loaded ${finalTrustedIssuers?.length || 0} trusted issuers and ${finalTrustedSubjects?.length || 0} trusted subjects`,
          );
        } catch (error) {
          log.error(
            `SAP CF mTLS: Failed to fetch certificates from endpoints: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Fall back to configured values
        }
      }
    }

    // Validate that we have at least one trusted issuer and subject configured
    if (
      !finalTrustedIssuers ||
      finalTrustedIssuers.length === 0 ||
      !finalTrustedSubjects ||
      finalTrustedSubjects.length === 0
    ) {
      throw ValidationError.fromErrors([
        "SAP CF mTLS mode requires at least one trusted issuer or trusted subject to be configured (from environment variables or config endpoints)",
      ]);
    }

    providerOpts.authentication.sapCfMtls = {
      enabled: true,
      trustedIssuers: finalTrustedIssuers,
      trustedSubjects: finalTrustedSubjects,
      decodeBase64Headers: process.env.MTLS_DECODE_BASE64_HEADERS !== "false",
      caChainFilePath: options.mtlsCaChainFile,
    };
  }

  return providerOpts;
}
