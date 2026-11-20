import { constants, createCipheriv, KeyObject, publicEncrypt, randomBytes } from "node:crypto";

/**
 * Test helper: encrypts a payload the way the SAP BTP Credential Store does (JWE compact, RSA-OAEP-256 + A256GCM).
 */
export function encryptJwe(
  plaintext: string,
  publicKey: KeyObject,
  header: Record<string, unknown> = { alg: "RSA-OAEP-256", enc: "A256GCM", iat: Math.round(Date.now() / 1000) },
): string {
  const protectedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const contentEncryptionKey = randomBytes(32);
  const iv = randomBytes(12);

  const encryptedKey = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    contentEncryptionKey,
  );
  const cipher = createCipheriv("aes-256-gcm", contentEncryptionKey, iv);
  cipher.setAAD(Buffer.from(protectedHeader, "ascii"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [protectedHeader, encryptedKey, iv, ciphertext, cipher.getAuthTag()]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}
