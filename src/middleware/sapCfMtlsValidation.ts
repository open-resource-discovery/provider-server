import { FastifyRequest, HookHandlerDoneFunction } from "fastify";
import { UnauthorizedError } from "src/model/error/UnauthorizedError.js";
import { tokenizeDn, dnTokensMatch } from "src/util/certificateHelpers.js";
import { log } from "src/util/logger.js";
import { CERT_ISSUER_DN_HEADER, CERT_SUBJECT_DN_HEADER } from "../constant.js";

export interface MtlsValidationOptions {
  trustedIssuers: string[];
  trustedSubjects: string[];
}

/**
 * Creates a Fastify authentication hook for SAP Cloud Foundry mTLS validation
 * Validates the client certificate issuer and subject from headers
 * Headers are always base64 encoded
 */
export function createSapCfMtlsValidator(options: MtlsValidationOptions) {
  const { trustedIssuers, trustedSubjects } = options;

  if (trustedIssuers.length === 0) {
    throw new Error("mTLS validation requires at least one trusted issuer");
  }

  if (trustedSubjects.length === 0) {
    throw new Error("mTLS validation requires at least one trusted subject");
  }

  return function mtlsAuth(request: FastifyRequest, _reply: unknown, done: HookHandlerDoneFunction): void {
    try {
      const issuerDnHeader = request.headers[CERT_ISSUER_DN_HEADER];
      const subjectDnHeader = request.headers[CERT_SUBJECT_DN_HEADER];

      if (!issuerDnHeader) {
        log.warn(`Missing mTLS headers: ${CERT_ISSUER_DN_HEADER}`);
        return done(new UnauthorizedError("Missing mTLS client certificate headers"));
      }

      if (!subjectDnHeader) {
        log.warn(`Missing mTLS headers: ${CERT_SUBJECT_DN_HEADER}`);
        return done(new UnauthorizedError("Missing mTLS client certificate headers"));
      }

      const issuerDnRaw = Array.isArray(issuerDnHeader) ? issuerDnHeader[0] : issuerDnHeader;
      const subjectDnRaw = Array.isArray(subjectDnHeader) ? subjectDnHeader[0] : subjectDnHeader;

      // Decode base64 encoded headers
      let issuerDn: string;
      let subjectDn: string;

      try {
        issuerDn = Buffer.from(issuerDnRaw, "base64").toString("utf-8");
        subjectDn = Buffer.from(subjectDnRaw, "base64").toString("utf-8");
      } catch {
        log.error("Failed to decode base64 mTLS headers: %s, %s", issuerDnRaw, subjectDnRaw);
        return done(new UnauthorizedError("Invalid mTLS header encoding"));
      }

      const issuerTokens = tokenizeDn(issuerDn);
      const isTrustedIssuer = trustedIssuers.some((trustedIssuer) => {
        const trustedTokens = tokenizeDn(trustedIssuer);
        return dnTokensMatch(issuerTokens, trustedTokens);
      });

      if (!isTrustedIssuer) {
        log.warn(`Untrusted certificate issuer: ${issuerDn}`);
        return done(new UnauthorizedError("Untrusted certificate issuer"));
      }

      const subjectTokens = tokenizeDn(subjectDn);
      const isTrustedSubject = trustedSubjects.some((trustedSubject) => {
        const trustedTokens = tokenizeDn(trustedSubject);
        return dnTokensMatch(subjectTokens, trustedTokens);
      });

      if (!isTrustedSubject) {
        log.warn(`Untrusted certificate subject: ${subjectDn}`);
        return done(new UnauthorizedError("Untrusted certificate subject"));
      }

      log.debug(`mTLS authentication successful for subject: ${subjectDn}`);
      done();
    } catch (error) {
      log.error(`mTLS validation error: ${error instanceof Error ? error.message : String(error)}`);
      done(new UnauthorizedError("mTLS validation failed"));
    }
  };
}
