import { X509Certificate } from "crypto";
import { ParsedCertificate, CertificateValidationResult, CertificateChain } from "../types/certificate.js";
import { CertificateLoader } from "./certificateLoader.js";
import { log } from "../util/logger.js";

export class CertificateValidator {
  public constructor(private readonly certificateLoader: CertificateLoader) {}

  // eslint-disable-next-line require-await
  public async validateCertificate(certificate: ParsedCertificate): Promise<CertificateValidationResult> {
    const result: CertificateValidationResult = {
      isValid: false,
      details: {},
    };

    // Check time validity
    const timeValidation = this.validateCertificateTime(certificate);
    result.details!.timeValid = timeValidation.isValid;
    if (!timeValidation.isValid) {
      result.error = timeValidation.error;
      return result;
    }

    // Build and validate certificate chain
    const chainValidation = this.validateCertificateChain(certificate);
    result.details!.chainValid = chainValidation.isValid;
    if (!chainValidation.isValid) {
      result.error = chainValidation.error;
      return result;
    }

    // All validations passed
    result.isValid = true;
    return result;
  }

  private validateCertificateTime(cert: ParsedCertificate): { isValid: boolean; error?: string } {
    const now = new Date();
    const validFrom = new Date(cert.validFrom);
    const validTo = new Date(cert.validTo);

    // Add 5-minute grace period for clock skew
    const graceMinutes = 5;
    const gracePeriod = graceMinutes * 60 * 1000;
    const nowWithGrace = new Date(now.getTime() - gracePeriod);
    const nowWithFutureGrace = new Date(now.getTime() + gracePeriod);

    if (nowWithGrace < validFrom) {
      return {
        isValid: false,
        error: `Certificate not yet valid. Valid from: ${validFrom.toISOString()}`,
      };
    }

    if (nowWithFutureGrace > validTo) {
      return {
        isValid: false,
        error: `Certificate expired. Valid until: ${validTo.toISOString()}`,
      };
    }

    return { isValid: true };
  }

  private validateCertificateChain(cert: ParsedCertificate): { isValid: boolean; error?: string } {
    try {
      const chain = this.buildCertificateChain(cert);

      if (!chain.root) {
        return {
          isValid: false,
          error: "Certificate chain does not terminate at a trusted root CA",
        };
      }

      // Validate each link in the chain
      const currentCert = cert.x509;
      const certPath = [currentCert, ...chain.intermediates.map((c) => c.x509)];

      if (chain.root) {
        certPath.push(chain.root.x509);
      }

      for (let i = 0; i < certPath.length - 1; i++) {
        const subject = certPath[i];
        const issuer = certPath[i + 1];

        if (!this.verifyCertificateSignature(subject, issuer)) {
          return {
            isValid: false,
            error: `Invalid signature in certificate chain at level ${i + 1}`,
          };
        }
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error: `Chain validation error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private buildCertificateChain(cert: ParsedCertificate): CertificateChain {
    const chain: CertificateChain = {
      clientCert: cert,
      intermediates: [],
    };

    let currentCert = cert.x509;
    const maxDepth = 10;
    let depth = 0;

    while (depth < maxDepth) {
      // Check if self-signed (root CA)
      if (currentCert.issuer === currentCert.subject) {
        // Check if it's a trusted root
        const trustedRoot = this.certificateLoader.getCertificateBySubject(currentCert.subject);
        if (trustedRoot && this.certificatesMatch(currentCert, trustedRoot)) {
          chain.root = {
            raw: trustedRoot.toString(),
            x509: trustedRoot,
            subject: { DN: trustedRoot.subject },
            issuer: { DN: trustedRoot.issuer },
            serialNumber: trustedRoot.serialNumber,
            validFrom: new Date(trustedRoot.validFrom),
            validTo: new Date(trustedRoot.validTo),
            fingerprint: trustedRoot.fingerprint,
          };
        }
        break;
      }

      // Find issuer certificate
      const issuerCert = this.certificateLoader.getCertificateBySubject(currentCert.issuer);
      if (!issuerCert) {
        log.warn(`Could not find issuer certificate for: ${currentCert.issuer}`);
        break;
      }

      // Add to intermediates
      chain.intermediates.push({
        raw: issuerCert.toString(),
        x509: issuerCert,
        subject: { DN: issuerCert.subject },
        issuer: { DN: issuerCert.issuer },
        serialNumber: issuerCert.serialNumber,
        validFrom: new Date(issuerCert.validFrom),
        validTo: new Date(issuerCert.validTo),
        fingerprint: issuerCert.fingerprint,
      });

      currentCert = issuerCert;
      depth++;
    }

    return chain;
  }

  private verifyCertificateSignature(subject: X509Certificate, issuer: X509Certificate): boolean {
    try {
      return subject.verify(issuer.publicKey);
    } catch (error) {
      log.debug(`Signature verification failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private certificatesMatch(cert1: X509Certificate, cert2: X509Certificate): boolean {
    return cert1.fingerprint === cert2.fingerprint;
  }
}
