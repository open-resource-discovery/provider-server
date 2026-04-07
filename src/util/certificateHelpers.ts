import { WILDCARD_DN } from "../constant.js";

export interface Certificate {
  issuer: string;
  subject: string;
}

/**
 * Check if a DN value is the explicit wildcard ("*")
 */
export function isWildcardDn(dn: string): boolean {
  return dn.trim() === WILDCARD_DN;
}

/**
 * Tokenize a Distinguished Name (DN) string into components
 * Supports both comma and slash separators
 */
export function tokenizeDn(dn: string): string[] {
  // Remove leading slash if present
  const cleanDn = dn.startsWith("/") ? dn.substring(1) : dn;
  const separator = dn.startsWith("/") ? "/" : ",";

  return cleanDn
    .split(separator)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Compare two arrays of DN tokens
 * Returns true if both arrays contain the same tokens
 */
export function dnTokensMatch(tokens1: string[], tokens2: string[]): boolean {
  if (tokens1.length !== tokens2.length) {
    return false;
  }

  const sorted1 = [...tokens1].sort();
  const sorted2 = [...tokens2].sort();

  return sorted1.every((token, index) => token === sorted2[index]);
}

export function isTrustedCertificate(certificate: Certificate, trustedCertificates: Certificate[]): boolean {
  const issuer = tokenizeDn(certificate.issuer);
  const subject = tokenizeDn(certificate.subject);

  return trustedCertificates.some((trustedCert) => {
    return (
      (isWildcardDn(trustedCert.issuer) || dnTokensMatch(issuer, tokenizeDn(trustedCert.issuer))) &&
      (isWildcardDn(trustedCert.subject) || dnTokensMatch(subject, tokenizeDn(trustedCert.subject)))
    );
  });
}
