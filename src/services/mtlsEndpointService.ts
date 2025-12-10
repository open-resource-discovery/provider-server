import { log } from "../util/logger.js";
import { tokenizeDn, dnTokensMatch } from "../util/certificateHelpers.js";

export interface MtlsCertInfo {
  certIssuer: string;
  certSubject: string;
}

export interface MtlsTrustedCerts {
  trustedCerts: { issuer: string; subject: string }[];
  trustedRootCaDns: string[];
}

/**
 * Fetches MTLS trusted certificate information from endpoints
 * @param endpoints Array of endpoint URLs to fetch from
 * @param timeoutMs Timeout for each request in milliseconds
 * @returns Combined list of trusted certificate pairs (issuer/subject)
 */
export async function fetchMtlsTrustedCertsFromEndpoints(
  endpoints: string[],
  timeoutMs: number = 10000,
): Promise<MtlsTrustedCerts> {
  const trustedCertsMap = new Map<string, { issuer: string; subject: string }>();

  const fetchPromises = endpoints.map(async (endpoint) => {
    try {
      const certInfo = await fetchMtlsCertInfo(endpoint, timeoutMs);
      if (certInfo.certIssuer && certInfo.certSubject) {
        // Use issuer+subject as key for deduplication
        const key = `${certInfo.certIssuer}|${certInfo.certSubject}`;
        trustedCertsMap.set(key, {
          issuer: certInfo.certIssuer,
          subject: certInfo.certSubject,
        });
      }
      log.info(`Successfully fetched MTLS cert info from ${endpoint}`);
    } catch (error) {
      log.error(
        `Failed to fetch MTLS cert info from ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  await Promise.all(fetchPromises);

  return {
    trustedCerts: Array.from(trustedCertsMap.values()),
    trustedRootCaDns: [], // Root CAs are not fetched from endpoints, only from env config
  };
}

/**
 * Fetches MTLS certificate information from a single endpoint
 * @param endpoint URL to fetch from
 * @param timeoutMs Request timeout in milliseconds
 * @returns Certificate issuer and subject information
 */
async function fetchMtlsCertInfo(endpoint: string, timeoutMs: number): Promise<MtlsCertInfo> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const parsed = (await response.json()) as MtlsCertInfo;

    // Validate the response structure
    if (!parsed.certIssuer || !parsed.certSubject) {
      throw new Error("Invalid response format: missing certIssuer or certSubject");
    }

    return {
      certIssuer: parsed.certIssuer,
      certSubject: parsed.certSubject,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }
    throw new Error(String(error));
  }
}

/**
 * Merges trusted certificates from endpoints with those from configuration
 * @param fromEndpoints Certificates fetched from endpoints
 * @param fromConfig Certificates from environment configuration
 * @returns Merged and deduplicated certificates
 */
export function mergeTrustedCerts(fromEndpoints: MtlsTrustedCerts, fromConfig: MtlsTrustedCerts): MtlsTrustedCerts {
  const certsMap = new Map<string, { issuer: string; subject: string }>();

  for (const cert of [...fromEndpoints.trustedCerts, ...fromConfig.trustedCerts]) {
    const key = `${cert.issuer}|${cert.subject}`;
    certsMap.set(key, cert);
  }

  // Use DN-aware deduplication for root CAs (order-independent matching)
  const rootCaDns: string[] = [];
  for (const dn of [...fromEndpoints.trustedRootCaDns, ...fromConfig.trustedRootCaDns]) {
    const dnTokens = tokenizeDn(dn);
    const isDuplicate = rootCaDns.some((existing) => dnTokensMatch(tokenizeDn(existing), dnTokens));
    if (!isDuplicate) {
      rootCaDns.push(dn);
    }
  }

  return {
    trustedCerts: Array.from(certsMap.values()),
    trustedRootCaDns: rootCaDns,
  };
}
