import { log } from "src/util/logger.js";

/**
 * Whether the server runs on Cloud Foundry. Uses the same indicator as the cf-mtls authentication check.
 */
export function isCloudFoundryEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CF_INSTANCE_GUID ?? "").trim() !== "";
}

export function getBaseUrlFromVcapEnv(vcapEnvString: string | undefined): string | undefined {
  if (!vcapEnvString) {
    return;
  }

  try {
    // In a CF environment we have the VCAP_APPLICATION env which can be used to get the actual app url
    const vcapObject = JSON.parse(vcapEnvString) as { application_uris: string[] };
    return vcapObject.application_uris.length > 0 ? `https://${vcapObject.application_uris[0]}` : undefined;
  } catch (ex) {
    log.error("Could not parse VCAP_APPLICATION env: %s", ex);
  }
}
