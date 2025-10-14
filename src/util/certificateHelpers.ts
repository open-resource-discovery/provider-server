import { Certificate } from "tls";
import { X509Certificate } from "crypto";
import { ParsedCertificate, CertificateSubject } from "../types/certificate.js";

/**
 * Tokenize a Distinguished Name (DN) string into components
 * Supports both comma and slash separators
 */
export function tokenizeDn(dn: string): string[] {
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
export function dnTokensMatch(tokens1: string[], tokens2: string[]): boolean {
  if (tokens1.length !== tokens2.length) {
    return false;
  }

  // Sort tokens to make comparison order-independent
  const sorted1 = [...tokens1].sort();
  const sorted2 = [...tokens2].sort();

  return sorted1.every((token, index) => token === sorted2[index]);
}

/**
 * Convert a certificate subject object to DN string format
 * Handles Node.js Certificate objects which have specific properties
 */
export function subjectToDn(subject: Certificate): string {
  const dnComponents: string[] = [];

  // Certificate type has these specific properties
  if (subject.CN) dnComponents.push(`CN=${subject.CN}`);
  if (subject.OU) dnComponents.push(`OU=${subject.OU}`);
  if (subject.O) dnComponents.push(`O=${subject.O}`);
  if (subject.L) dnComponents.push(`L=${subject.L}`);
  if (subject.ST) dnComponents.push(`ST=${subject.ST}`);
  if (subject.C) dnComponents.push(`C=${subject.C}`);

  return dnComponents.join(",");
}

export function parseCertificateFromPem(pemString: string): ParsedCertificate | null {
  try {
    const x509 = new X509Certificate(pemString);

    return {
      raw: pemString,
      x509,
      subject: parseDnString(x509.subject),
      issuer: parseDnString(x509.issuer),
      serialNumber: x509.serialNumber,
      validFrom: new Date(x509.validFrom),
      validTo: new Date(x509.validTo),
      fingerprint: x509.fingerprint,
    };
  } catch {
    return null;
  }
}

export function parseDnString(dnString: string): CertificateSubject {
  const subject: CertificateSubject = { DN: dnString };

  const parts = dnString.split(/,(?=\w+=)/);
  parts.forEach((part) => {
    const [key, ...valueParts] = part.trim().split("=");
    const value = valueParts.join("=");

    switch (key) {
      case "CN":
        subject.CN = value;
        break;
      case "O":
        subject.O = value;
        break;
      case "OU":
        subject.OU = value;
        break;
      case "C":
        subject.C = value;
        break;
      case "L":
        subject.L = value;
        break;
      case "ST":
        subject.ST = value;
        break;
    }
  });

  return subject;
}

export function extractCertificateFromHeader(headerValue: string): string | null {
  if (!headerValue) return null;

  // Handle x-forwarded-client-cert format
  const certMatch = headerValue.match(/Cert="([^"]+)"/i);
  if (certMatch) {
    const urlEncodedCert = certMatch[1];
    const decodedCert = decodeURIComponent(urlEncodedCert);
    return formatPemCertificate(decodedCert);
  }

  // Handle direct base64 encoded certificate
  if (isBase64(headerValue)) {
    const decoded = Buffer.from(headerValue, "base64").toString("utf-8");
    return formatPemCertificate(decoded);
  }

  return null;
}

function formatPemCertificate(cert: string): string {
  cert = cert.trim();

  if (!cert.includes("-----BEGIN CERTIFICATE-----")) {
    cert = `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;
  }

  // Ensure proper line breaks
  cert = cert.replace(/-----BEGIN CERTIFICATE-----/g, "-----BEGIN CERTIFICATE-----\n");
  cert = cert.replace(/-----END CERTIFICATE-----/g, "\n-----END CERTIFICATE-----");

  return cert;
}

function isBase64(str: string): boolean {
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return base64Regex.test(str) && str.length % 4 === 0;
}

export function isExpiredCertificate(cert: ParsedCertificate): boolean {
  const now = new Date();
  return now < cert.validFrom || now > cert.validTo;
}

export function getCertificateValidityWindow(cert: ParsedCertificate): {
  isValid: boolean;
  validFrom: Date;
  validTo: Date;
  daysRemaining?: number;
} {
  const now = new Date();
  const isValid = now >= cert.validFrom && now <= cert.validTo;

  const result: {
    isValid: boolean;
    validFrom: Date;
    validTo: Date;
    daysRemaining?: number;
  } = {
    isValid,
    validFrom: cert.validFrom,
    validTo: cert.validTo,
  };

  if (isValid) {
    const msRemaining = cert.validTo.getTime() - now.getTime();
    result.daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
  }

  return result;
}
