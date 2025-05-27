import { log } from "src/util/logger.js";
import { CommandLineOptions, OptAuthMethod, OptSourceType } from "src/model/cli.js";
import { getBaseUrl as updateBaseUrl } from "src/util/ordConfig.js";
import { normalizePath } from "src/util/pathUtils.js";
import { trimLeadingAndTrailingSlashes, trimTrailingSlash } from "src/util/optsValidation.js";
import { config } from "dotenv";
import { MtlsMode } from "../constant.js";
import { fetchMtlsTrustedCertsFromEndpoints, mergeTrustedCerts } from "../services/mtlsEndpointService.js";

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
    };
  };
  mtls?: {
    caPath: string;
    certPath: string;
    keyPath: string;
    rejectUnauthorized: boolean;
    trustedIssuers?: string[];
    trustedSubjects?: string[];
  };
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
  };

  if (options.auth.includes(OptAuthMethod.MTLS)) {
    // Check if SAP CF mTLS mode is enabled
    const mtlsMode = process.env.MTLS_MODE || MtlsMode.Standard;

    if (mtlsMode === MtlsMode.SapCmpMtls) {
      // In SAP CF mode, certificate files are not required
      providerOpts.authentication.sapCfMtls = {
        enabled: true,
        trustedIssuers: process.env.MTLS_TRUSTED_ISSUERS ? process.env.MTLS_TRUSTED_ISSUERS.split(";") : undefined,
        trustedSubjects: process.env.MTLS_TRUSTED_SUBJECTS ? process.env.MTLS_TRUSTED_SUBJECTS.split(";") : undefined,
        decodeBase64Headers: process.env.MTLS_DECODE_BASE64_HEADERS !== "false",
      };
    }

    // Initialize base mTLS configuration
    providerOpts.mtls = {
      caPath: options.mtlsCaPath!,
      certPath: options.mtlsCertPath!,
      keyPath: options.mtlsKeyPath!,
      rejectUnauthorized: options.mtlsRejectUnauthorized !== undefined ? options.mtlsRejectUnauthorized : true,
    };

    // For standard mTLS mode, handle trusted issuers and subjects
    if (mtlsMode !== MtlsMode.SapCmpMtls) {
      // Parse configured trusted issuers and subjects
      const configuredTrustedCerts = {
        trustedIssuers: process.env.MTLS_TRUSTED_ISSUERS ? process.env.MTLS_TRUSTED_ISSUERS.split(";") : undefined,
        trustedSubjects: process.env.MTLS_TRUSTED_SUBJECTS ? process.env.MTLS_TRUSTED_SUBJECTS.split(";") : undefined,
      };

      // Fetch from endpoints if configured
      if (process.env.MTLS_CONFIG_ENDPOINTS) {
        const endpoints = process.env.MTLS_CONFIG_ENDPOINTS.split(";").filter((e) => e.trim());
        if (endpoints.length > 0) {
          log.info(`Fetching MTLS trusted certificates from ${endpoints.length} endpoints...`);
          try {
            const endpointCerts = await fetchMtlsTrustedCertsFromEndpoints(endpoints);
            const mergedCerts = mergeTrustedCerts(endpointCerts, configuredTrustedCerts);

            providerOpts.mtls.trustedIssuers = mergedCerts.trustedIssuers;
            providerOpts.mtls.trustedSubjects = mergedCerts.trustedSubjects;

            log.info(
              `Loaded ${providerOpts.mtls.trustedIssuers?.length || 0} trusted issuers and ${providerOpts.mtls.trustedSubjects?.length || 0} trusted subjects`,
            );
          } catch (error) {
            log.error(
              `Failed to fetch MTLS certificates from endpoints: ${error instanceof Error ? error.message : String(error)}`,
            );
            // Fall back to configured values
            providerOpts.mtls.trustedIssuers = configuredTrustedCerts.trustedIssuers;
            providerOpts.mtls.trustedSubjects = configuredTrustedCerts.trustedSubjects;
          }
        }
      } else {
        // Use only configured values
        providerOpts.mtls.trustedIssuers = configuredTrustedCerts.trustedIssuers;
        providerOpts.mtls.trustedSubjects = configuredTrustedCerts.trustedSubjects;
      }
    }
  }

  return providerOpts;
}
