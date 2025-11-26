import { FastifyRequest, HookHandlerDoneFunction } from "fastify";
import { UnauthorizedError } from "src/model/error/UnauthorizedError.js";
import { tokenizeDn, dnTokensMatch } from "src/util/certificateHelpers.js";
import { log } from "src/util/logger.js";
import {
  CERT_ISSUER_DN_HEADER,
  CERT_SUBJECT_DN_HEADER,
  CERT_ROOT_CA_DN_HEADER,
  CERT_XFCC_HEADER,
  CERT_CLIENT_HEADER,
  CERT_CLIENT_VERIFY_HEADER,
} from "../constant.js";

export interface MtlsValidationOptions {
  trustedCerts: { issuer: string; subject: string }[];
  trustedRootCaDns: string[];
}

/**
 * Checks if the request has valid XFCC (X-Forwarded-Client-Cert) headers
 * indicating the proxy has already verified the client certificate.
 *
 * Conditions:
 * - X-Forwarded-Client-Cert header exists
 * - X-Ssl-Client header equals "1"
 * - X-Ssl-Client-Verify header equals "0" (verification success)
 */
function isXfccProxyVerified(request: FastifyRequest): boolean {
  const xfcc = request.headers[CERT_XFCC_HEADER];
  const sslClient = request.headers[CERT_CLIENT_HEADER];
  const sslVerify = request.headers[CERT_CLIENT_VERIFY_HEADER];

  // Handle array headers by taking first value
  const sslClientValue = Array.isArray(sslClient) ? sslClient[0] : sslClient;
  const sslVerifyValue = Array.isArray(sslVerify) ? sslVerify[0] : sslVerify;

  return xfcc !== undefined && sslClientValue === "1" && sslVerifyValue === "0";
}

/**
 * Creates a Fastify authentication hook for SAP Cloud Foundry mTLS validation
 * Validates the client certificate issuer and subject as a pair, and root CA from headers
 * Headers are always base64 encoded
 */
export function createSapCfMtlsValidator(options: MtlsValidationOptions) {
  const { trustedCerts, trustedRootCaDns } = options;

  if (trustedCerts.length === 0) {
    throw new Error("mTLS validation requires at least one trusted certificate (issuer/subject pair)");
  }

  if (trustedRootCaDns.length === 0) {
    throw new Error("mTLS validation requires at least one trusted root CA DN");
  }

  return function mtlsAuth(request: FastifyRequest, _reply: unknown, done: HookHandlerDoneFunction): void {
    try {
      // Check XFCC proxy-verified path first
      if (!isXfccProxyVerified(request)) {
        log.debug("Missing proxy verification of mTLS client certificate via XFCC headers");
        return done(new UnauthorizedError("Missing proxy verification of mTLS client certificate"));
      }

      const issuerDnHeader = request.headers[CERT_ISSUER_DN_HEADER];
      const subjectDnHeader = request.headers[CERT_SUBJECT_DN_HEADER];
      const rootCaDnHeader = request.headers[CERT_ROOT_CA_DN_HEADER];

      if (!issuerDnHeader) {
        log.warn(`Missing mTLS headers: ${CERT_ISSUER_DN_HEADER}`);
        return done(new UnauthorizedError("Missing mTLS client certificate headers"));
      }

      if (!subjectDnHeader) {
        log.warn(`Missing mTLS headers: ${CERT_SUBJECT_DN_HEADER}`);
        return done(new UnauthorizedError("Missing mTLS client certificate headers"));
      }

      if (!rootCaDnHeader) {
        log.warn(`Missing mTLS headers: ${CERT_ROOT_CA_DN_HEADER}`);
        return done(new UnauthorizedError("Missing mTLS client certificate headers"));
      }

      const issuerDnRaw = Array.isArray(issuerDnHeader) ? issuerDnHeader[0] : issuerDnHeader;
      const subjectDnRaw = Array.isArray(subjectDnHeader) ? subjectDnHeader[0] : subjectDnHeader;
      const rootCaDnRaw = Array.isArray(rootCaDnHeader) ? rootCaDnHeader[0] : rootCaDnHeader;

      // Decode base64 encoded headers
      let issuerDn: string;
      let subjectDn: string;
      let rootCaDn: string;

      try {
        issuerDn = Buffer.from(issuerDnRaw, "base64").toString("utf-8");
        subjectDn = Buffer.from(subjectDnRaw, "base64").toString("utf-8");
        rootCaDn = Buffer.from(rootCaDnRaw, "base64").toString("utf-8");
      } catch {
        log.error("Failed to decode base64 mTLS headers: %s, %s, %s", issuerDnRaw, subjectDnRaw, rootCaDnRaw);
        return done(new UnauthorizedError("Invalid mTLS header encoding"));
      }

      const issuerTokens = tokenizeDn(issuerDn);
      const subjectTokens = tokenizeDn(subjectDn);

      const isTrustedCert = trustedCerts.some((trustedCert) => {
        const trustedIssuerTokens = tokenizeDn(trustedCert.issuer);
        const trustedSubjectTokens = tokenizeDn(trustedCert.subject);

        const issuerMatches = dnTokensMatch(issuerTokens, trustedIssuerTokens);
        const subjectMatches = dnTokensMatch(subjectTokens, trustedSubjectTokens);

        return issuerMatches && subjectMatches;
      });

      if (!isTrustedCert) {
        log.warn(`Untrusted certificate pair - issuer: ${issuerDn}, subject: ${subjectDn}`);
        return done(new UnauthorizedError("Untrusted certificate (issuer/subject pair not found)"));
      }

      const rootCaTokens = tokenizeDn(rootCaDn);
      const isTrustedRootCa = trustedRootCaDns.some((trustedRootCaDn) => {
        const trustedTokens = tokenizeDn(trustedRootCaDn);
        return dnTokensMatch(rootCaTokens, trustedTokens);
      });

      if (!isTrustedRootCa) {
        log.warn(`Untrusted certificate root CA: ${rootCaDn}`);
        return done(new UnauthorizedError("Untrusted certificate root CA"));
      }

      log.debug(`mTLS authentication successful for subject: ${subjectDn}`);
      done();
    } catch (error) {
      log.error(`mTLS validation error: ${error instanceof Error ? error.message : String(error)}`);
      done(new UnauthorizedError("mTLS validation failed"));
    }
  };
}
