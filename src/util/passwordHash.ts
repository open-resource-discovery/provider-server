import * as bcrypt from "bcrypt";

/**
 * Compares a plain text password with a hashed password
 * @param password Plain text password to check
 * @param hashedPassword Hashed password to compare against
 * @returns Promise resolving to true if passwords match, false otherwise
 */
export async function comparePassword(password: string, hashedPassword: string): Promise<boolean> {
  if (!password || !hashedPassword) {
    throw new Error("Password and hashed password are required");
  }
  return await bcrypt.compare(password, hashedPassword.replace(/^\$2y/, "$2a"));
}

/**
 * Validates if a string is a bcrypt hash
 * @param hash String to validate
 * @returns boolean indicating if the string is a bcrypt hash
 */
export function isBcryptHash(hash: string): boolean {
  return /^\$2[ayb]\$\d{2}\$[A-Za-z0-9./]{53}$/.test(hash);
}
