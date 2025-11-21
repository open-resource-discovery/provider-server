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
