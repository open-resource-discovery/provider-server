import assert from "node:assert";

import isBase64 from "is-base64";
import { FastifyRequest, HookHandlerDoneFunction } from "fastify";

import { log } from "src/util/logger.js";
import { UnauthorizedError } from "src/model/error/UnauthorizedError.js";
import { CERT_SUBJECT_HEADER, CERT_ISSUER_HEADER } from "src/constant.js";
import { isTrustedCertificate, Certificate } from "src/util/certificateHelpers.js";

function asScalar<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

function extractClientCertificate(request: FastifyRequest): Certificate {
  return {
    issuer: extractDistinguishedName(request, CERT_ISSUER_HEADER),
    subject: extractDistinguishedName(request, CERT_SUBJECT_HEADER),
  };
}

function extractDistinguishedName(request: FastifyRequest, header: string): string {
  const value = asScalar(request.headers[header]);

  assert(value, `Missing required header: ${header}`);
  assert(isBase64(value), `Invalid value of header: ${header}`);

  return Buffer.from(value, "base64").toString("utf-8");
}

/**
 * Creates a Fastify authentication hook for SAP Kyma mTLS validation.
 * Validates the client certificate issuer and subject as a pair from headers.
 * Headers are always base64 encoded
 */
export function createSapKymaMtlsValidator(options: { trustedCerts: Certificate[] }) {
  assert(
    options?.trustedCerts?.length > 0,
    "mTLS validation requires at least one trusted certificate (issuer/subject pair)",
  );

  return function mtlsAuth(request: FastifyRequest, _reply: unknown, done: HookHandlerDoneFunction): void {
    try {
      const certificate: Certificate = extractClientCertificate(request);

      if (!isTrustedCertificate(certificate, options.trustedCerts)) {
        log.warn(`Untrusted certificate pair - issuer: ${certificate.issuer}, subject: ${certificate.subject}`);
        return done(new UnauthorizedError("Untrusted certificate (issuer/subject pair not found)"));
      }

      done();
    } catch (error) {
      log.error(`mTLS validation error: ${error instanceof Error ? error.message : String(error)}`);
      done(new UnauthorizedError("mTLS validation failed"));
    }
  };
}
