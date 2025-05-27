import { Certificate } from "tls";

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
