#!/usr/bin/env node
import { config } from "dotenv";
config();

import { Command, Option } from "commander";
import packageJson from "package.json" with { type: "json" };
import { CommandLineOptions, OptAuthMethod, OptSourceType, parseAuthMethods, parseSourceType } from "src/model/cli.js";
import { startProviderServer } from "src/server.js";
import { getBaseUrlFromVcapEnv } from "src/util/env.js";
import { log } from "src/util/logger.js";
import { validateAndParseOptions } from "src/util/optsValidation.js";
import { ValidationError } from "./model/error/ValidationError.js";
import { showCleanHelp } from "./util/cliHelp.js";
import { PATH_CONSTANTS } from "./constant.js";

const program = new Command();

program
  .name("ord-provider-server")
  .addOption(
    new Option("--base-url <baseUrl>", `Base URL without ${PATH_CONSTANTS.WELL_KNOWN_ENDPOINT} path`)
      .default(process.env.ORD_BASE_URL || getBaseUrlFromVcapEnv(process.env.VCAP_APPLICATION))
      .makeOptionMandatory(),
  )
  .option(
    "-s, --source-type <sourceType>",
    `Location of the document and resource files. (choices: "${Object.values(OptSourceType).join('", "')}")`,
    parseSourceType,
    process.env.ORD_SOURCE_TYPE ? parseSourceType(process.env.ORD_SOURCE_TYPE) : OptSourceType.Local,
  )
  .option(
    "-d, --directory <directory>",
    'Directory containing ORD documents. Required when source-type is "local".',
    process.env.ORD_DIRECTORY || PATH_CONSTANTS.GITHUB_DEFAULT_ROOT,
  )
  .option(
    "--documents-subdirectory <subdirectory>",
    "Subdirectory name for ORD documents within the main directory (default: 'documents')",
    PATH_CONSTANTS.DOCUMENTS_SUBDIRECTORY,
  )
  .option(
    "-a, --auth <authTypes>",
    `Authentication methods to use. (choices: "${Object.values(OptAuthMethod).join('", "')}")`,
    parseAuthMethods,
    process.env.ORD_AUTH_TYPE ? parseAuthMethods(process.env.ORD_AUTH_TYPE) : [OptAuthMethod.Open],
  )
  .option("--host <host>", "Host for server, without port", process.env.SERVER_HOST || "0.0.0.0")
  .option("--port <port number>", "Server port", process.env.SERVER_PORT || "8080")
  .option("--github-api-url <githubApiUrl>", "GitHub host to make API calls", process.env.GITHUB_API_URL)
  .option("--github-branch <githubBranch>", "GitHub branch", process.env.GITHUB_BRANCH)
  .option("--github-repository <githubRepository>", "GitHub repository <OWNER>/<REPO>", process.env.GITHUB_REPOSITORY)
  .option("--github-token <githubToken>", "GitHub token for authentication", process.env.GITHUB_TOKEN)
  .option("--data-dir <dataDir>", "Base directory for content storage", process.env.ORD_DATA_DIR || "./data")
  .option(
    "--update-delay <updateDelay>",
    "Cooldown between webhook-triggered updates (seconds)",
    process.env.UPDATE_DELAY || "5",
  )
  .option(
    "--status-dashboard-enabled <statusDashboardEnabled>",
    "Enable/disable status dashboard (true/false)",
    process.env.STATUS_DASHBOARD_ENABLED || "true",
  )
  .option(
    "--mtls-ca-path <path>",
    "Path to CA certificate for validating client certificates",
    process.env.MTLS_CA_PATH,
  )
  .option("--mtls-cert-path <path>", "Path to server certificate", process.env.MTLS_CERT_PATH)
  .option("--mtls-key-path <path>", "Path to server private key", process.env.MTLS_KEY_PATH)
  .option(
    "--mtls-reject-unauthorized",
    "Reject unauthorized clients (defaults to true)",
    process.env.MTLS_REJECT_UNAUTHORIZED !== "false",
  )
  .option("--mtls-mode <mode>", "mTLS mode (standard or sap:cmp-mtls)", process.env.MTLS_MODE || "standard")
  .option(
    "--mtls-trusted-issuers <issuers>",
    "Semicolon-separated list of trusted certificate issuers (DN format)",
    process.env.MTLS_TRUSTED_ISSUERS,
  )
  .option(
    "--mtls-trusted-subjects <subjects>",
    "Semicolon-separated list of trusted certificate subjects (DN format)",
    process.env.MTLS_TRUSTED_SUBJECTS,
  )
  .option(
    "--mtls-config-endpoints <endpoints>",
    "Semicolon-separated list of URLs to fetch certificate configuration from",
    process.env.MTLS_CONFIG_ENDPOINTS,
  );

program.version(packageJson.version);
program.addHelpText("before", "Loads and validates ORD documents and exposes them as an ORD Document API\n");

program.parse();

const options = program.opts<CommandLineOptions>();
try {
  const providerServerOptions = await validateAndParseOptions(options);

  startProviderServer(providerServerOptions).catch((error: unknown) => {
    if (error instanceof ValidationError) {
      log.error(error.message);
    } else {
      log.fatal(String(error));
    }
  });
} catch (error) {
  log.error(String(error));
  // Only show help if not in production mode
  if (process.env.NODE_ENV !== "production") {
    showCleanHelp(program);
  }
  process.exit(1);
}
