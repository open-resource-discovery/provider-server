import { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from "fastify";
import { log } from "../util/logger.js";
import {
  extractCertificateFromHeader,
  parseCertificateFromPem,
  tokenizeDn,
  dnTokensMatch,
} from "../util/certificateHelpers.js";
import { getCertificateLoader } from "../services/certificateLoader.js";
import { CertificateValidator } from "../services/certificateValidator.js";
import { ParsedCertificate } from "../types/certificate.js";

// Extend FastifyRequest to include client certificate info and mTLS authentication status
declare module "fastify" {
  interface FastifyRequest {
    isMtlsAuthenticated?: boolean;
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
      parsed?: ParsedCertificate;
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
  caChainFilePath?: string;
}

let certificateValidator: CertificateValidator | null = null;

async function initializeValidationServices(caChainFilePath?: string): Promise<void> {
  if (!certificateValidator) {
    const loader = await getCertificateLoader(caChainFilePath);
    certificateValidator = new CertificateValidator(loader);
  }
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
  const { trustedIssuers = [], trustedSubjects = [], decodeBase64Headers = true, caChainFilePath } = options;

  // Always initialize certificate validator for full validation
  if (!certificateValidator) {
    initializeValidationServices(caChainFilePath).catch((err) => {
      log.error("Failed to initialize certificate validation services:", err);
    });
  }

  return function sapCfMtlsAuthHook(
    request: FastifyRequest,
    _reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ): void {
    (async (): Promise<void> => {
      try {
        const headers = request.headers as SapCfMtlsHeaders;

        // Check verification status (0 = successful verification)
        // This is the CRITICAL check - HAProxy has already validated the certificate against the CA
        // We trust this header because SAP CF strips any client-provided headers before setting it
        const verifyStatus = headers["x-ssl-client-verify"];
        if (verifyStatus !== "0") {
          log.warn(`SAP CF mTLS: Client certificate verification failed. Status: ${verifyStatus}`);
          // Mark as not authenticated via mTLS and continue (to allow basic auth)
          request.isMtlsAuthenticated = false;
          return done();
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

        log.debug(
          "SAP CF mTLS: Client certificate details %s",
          JSON.stringify({
            subjectDn,
            subjectCn,
            issuerDn,
            rootCaDn,
            sessionId: headers["x-ssl-client-session-id"],
          }),
        );

        // Always perform full certificate validation
        const certHeader = headers["x-forwarded-client-cert"];
        if (!certHeader) {
          log.warn("SAP CF mTLS: Missing x-forwarded-client-cert header - full validation required");
          request.isMtlsAuthenticated = false;
          return done();
        }

        const pemCert = extractCertificateFromHeader(certHeader);
        if (!pemCert) {
          log.warn("SAP CF mTLS: Failed to extract certificate from header");
          request.isMtlsAuthenticated = false;
          return done();
        }

        const parsedCert = parseCertificateFromPem(pemCert);
        if (!parsedCert) {
          log.warn("SAP CF mTLS: Failed to parse certificate");
          request.isMtlsAuthenticated = false;
          return done();
        }

        // Ensure certificate validator is initialized
        if (!certificateValidator) {
          log.error("SAP CF mTLS: Certificate validator not initialized");
          request.isMtlsAuthenticated = false;
          return done();
        }

        // Perform full certificate validation
        const validationResult = await certificateValidator.validateCertificate(parsedCert);

        if (!validationResult.isValid) {
          log.warn(`SAP CF mTLS: Full certificate validation failed. ${validationResult.error}`);
          request.isMtlsAuthenticated = false;
          return done();
        }

        // Validate subject if trusted subjects are configured
        if (trustedSubjects.length > 0 && subjectDn) {
          const subjectTokens = tokenizeDn(subjectDn);
          const isTrustedSubject = trustedSubjects.some((trustedSubject) => {
            const trustedTokens = tokenizeDn(trustedSubject);
            return dnTokensMatch(subjectTokens, trustedTokens);
          });

          if (!isTrustedSubject) {
            log.warn(`SAP CF mTLS: Certificate subject not trusted. Subject: ${subjectDn}`);
            request.isMtlsAuthenticated = false;
            return done();
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
            request.isMtlsAuthenticated = false;
            return done();
          }
        }

        // Store parsed certificate in request
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
          parsed: parsedCert,
        };

        // If we got here, mTLS authentication succeeded
        request.isMtlsAuthenticated = true;
        log.info(`SAP CF mTLS: Client certificate authorized. Subject CN: ${subjectCn}`);
        done();
      } catch (error) {
        log.error(`SAP CF mTLS: Error during client certificate validation: ${error}`);
        // Mark as not authenticated via mTLS and continue (to allow basic auth)
        request.isMtlsAuthenticated = false;
        done();
      }
    })().catch((error) => {
      log.error("SAP CF mTLS: Unexpected error in async wrapper:", error);
      request.isMtlsAuthenticated = false;
      done();
    });
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
