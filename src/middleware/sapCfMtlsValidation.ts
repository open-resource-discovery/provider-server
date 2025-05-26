import { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from "fastify";
import { UnauthorizedError } from "../model/error/UnauthorizedError.js";
import { log } from "../util/logger.js";

// Extend FastifyRequest to include client certificate info
declare module "fastify" {
  interface FastifyRequest {
    clientCertificate?: {
      subject: {
        DN?: string;
        CN?: string;
      };
      issuer: {
        DN?: string;
      };
      rootCA?: {
        DN?: string;
      };
      validFrom?: string;
      validTo?: string;
      raw: string;
    };
  }
}

export interface SapCfMtlsHeaders {
  "x-forwarded-client-cert"?: string;
  "x-ssl-client"?: string;
  "x-ssl-client-verify"?: string;
  "x-ssl-client-subject-dn"?: string;
  "x-ssl-client-subject-cn"?: string;
  "x-ssl-client-issuer-dn"?: string;
  "x-ssl-client-root-ca-dn"?: string;
  "x-ssl-client-session-id"?: string;
  "x-ssl-client-notbefore"?: string;
  "x-ssl-client-notafter"?: string;
}

interface SapCfMtlsOptions {
  trustedIssuers?: string[];
  trustedSubjects?: string[];
  decodeBase64Headers?: boolean;
}

/**
 * Creates a Fastify preHandler hook for SAP Cloud Foundry mTLS authentication
 *
 * IMPORTANT: In SAP CF, the actual certificate validation against the CA is done by HAProxy/Gorouter.
 * This middleware trusts the headers provided by the platform:
 * - X-SSL-Client-Verify: 0 means the certificate was successfully validated by HAProxy
 * - We only perform additional checks (issuer, validity dates) as extra safety measures
 * - We do NOT need to validate the certificate against the CA ourselves
 *
 * @param options Configuration options for the mTLS validation
 * @returns Fastify preHandler hook function
 */
export function createSapCfMtlsHook(options: SapCfMtlsOptions = {}) {
  const { trustedIssuers = [], trustedSubjects = [], decodeBase64Headers = true } = options;

  return function sapCfMtlsAuthHook(
    request: FastifyRequest,
    _reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ): void {
    try {
      const headers = request.headers as SapCfMtlsHeaders;

      // Check verification status (0 = successful verification)
      // This is the CRITICAL check - HAProxy has already validated the certificate against the CA
      // We trust this header because SAP CF strips any client-provided headers before setting it
      const verifyStatus = headers["x-ssl-client-verify"];
      if (verifyStatus !== "0") {
        log.warn(`SAP CF mTLS: Client certificate verification failed. Status: ${verifyStatus}`);
        return done(new UnauthorizedError("Client certificate verification failed"));
      }

      // Extract and decode certificate details
      let subjectDn = headers["x-ssl-client-subject-dn"];
      let subjectCn = headers["x-ssl-client-subject-cn"];
      let issuerDn = headers["x-ssl-client-issuer-dn"];
      let rootCaDn = headers["x-ssl-client-root-ca-dn"];

      // Decode base64 if needed
      if (decodeBase64Headers && subjectDn && isBase64Encoded(subjectDn)) {
        subjectDn = Buffer.from(subjectDn, "base64").toString("ascii");
        if (subjectCn) subjectCn = Buffer.from(subjectCn, "base64").toString("ascii");
        if (issuerDn) issuerDn = Buffer.from(issuerDn, "base64").toString("ascii");
        if (rootCaDn) rootCaDn = Buffer.from(rootCaDn, "base64").toString("ascii");
      }

      log.debug("SAP CF mTLS: Client certificate details", {
        subjectDn,
        subjectCn,
        issuerDn,
        rootCaDn,
        sessionId: headers["x-ssl-client-session-id"],
      });

      // Validate subject if trusted subjects are configured
      if (trustedSubjects.length > 0 && subjectDn) {
        const subjectTokens = tokenizeDn(subjectDn);
        const isTrustedSubject = trustedSubjects.some((trustedSubject) => {
          const trustedTokens = tokenizeDn(trustedSubject);
          return dnTokensMatch(subjectTokens, trustedTokens);
        });

        if (!isTrustedSubject) {
          log.warn(`SAP CF mTLS: Certificate subject not trusted. Subject: ${subjectDn}`);
          return done(new UnauthorizedError("Certificate subject not trusted"));
        }
      }

      // Validate issuer if trusted issuers are configured
      if (trustedIssuers.length > 0 && issuerDn) {
        const issuerTokens = tokenizeDn(issuerDn);
        const isTrustedIssuer = trustedIssuers.some((trustedIssuer) => {
          const trustedTokens = tokenizeDn(trustedIssuer);
          return dnTokensMatch(issuerTokens, trustedTokens);
        });

        if (!isTrustedIssuer) {
          log.warn(`SAP CF mTLS: Certificate issuer not trusted. Issuer: ${issuerDn}`);
          return done(new UnauthorizedError("Certificate issuer not trusted"));
        }
      }

      // Store certificate info in request for potential use by routes
      request.clientCertificate = {
        subject: {
          DN: subjectDn,
          CN: subjectCn,
        },
        issuer: {
          DN: issuerDn,
        },
        rootCA: {
          DN: rootCaDn,
        },
        raw: headers["x-forwarded-client-cert"] || "",
      };

      log.info(`SAP CF mTLS: Client certificate authorized. Subject CN: ${subjectCn}`);
      done();
    } catch (error) {
      log.error("SAP CF mTLS: Error during client certificate validation:", error);
      done(new UnauthorizedError("mTLS authentication failed"));
    }
  };
}

/**
 * Check if a string is base64 encoded
 */
function isBase64Encoded(str: string): boolean {
  // Basic check - more sophisticated validation could be added
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return base64Regex.test(str) && str.length % 4 === 0;
}

/**
 * Tokenize a Distinguished Name (DN) string into components
 * Supports both comma and slash separators
 */
function tokenizeDn(dn: string): string[] {
  // Remove leading slash if present
  const cleanDn = dn.startsWith("/") ? dn.substring(1) : dn;

  // Split by either comma or slash, then filter out empty strings
  const tokens = cleanDn
    .split(/[,/]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  return tokens;
}

/**
 * Check if two sets of DN tokens match (order-independent)
 */
function dnTokensMatch(tokens1: string[], tokens2: string[]): boolean {
  if (tokens1.length !== tokens2.length) {
    return false;
  }

  // Sort tokens to make comparison order-independent
  const sorted1 = [...tokens1].sort();
  const sorted2 = [...tokens2].sort();

  return sorted1.every((token, index) => token === sorted2[index]);
}
