import { log } from "../util/logger.js";

export interface MtlsCertInfo {
  certIssuer: string;
  certSubject: string;
}

export interface MtlsTrustedCerts {
  trustedIssuers: string[];
  trustedSubjects: string[];
  trustedRootCas: string[];
}

/**
 * Fetches MTLS trusted certificate information from endpoints
 * @param endpoints Array of endpoint URLs to fetch from
 * @param timeoutMs Timeout for each request in milliseconds
 * @returns Combined lists of trusted issuers and subjects
 */
export async function fetchMtlsTrustedCertsFromEndpoints(
  endpoints: string[],
  timeoutMs: number = 10000,
): Promise<MtlsTrustedCerts> {
  const trustedIssuers = new Set<string>();
  const trustedSubjects = new Set<string>();

  const fetchPromises = endpoints.map(async (endpoint) => {
    try {
      const certInfo = await fetchMtlsCertInfo(endpoint, timeoutMs);
      if (certInfo.certIssuer) {
        trustedIssuers.add(certInfo.certIssuer);
      }
      if (certInfo.certSubject) {
        trustedSubjects.add(certInfo.certSubject);
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
    trustedIssuers: Array.from(trustedIssuers),
    trustedSubjects: Array.from(trustedSubjects),
    trustedRootCas: [], // Root CAs are not fetched from endpoints, only from env config
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
  const issuers = new Set([...fromEndpoints.trustedIssuers, ...fromConfig.trustedIssuers]);
  const subjects = new Set([...fromEndpoints.trustedSubjects, ...fromConfig.trustedSubjects]);
  const rootCas = new Set([...fromEndpoints.trustedRootCas, ...fromConfig.trustedRootCas]);

  return {
    trustedIssuers: Array.from(issuers),
    trustedSubjects: Array.from(subjects),
    trustedRootCas: Array.from(rootCas),
  };
}
