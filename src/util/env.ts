import { log } from "src/util/logger.js";

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
