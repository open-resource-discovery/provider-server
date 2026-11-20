import { constants, createDecipheriv, createPrivateKey, KeyObject, privateDecrypt } from "node:crypto";

// The only algorithms the SAP BTP Credential Store uses for payload encryption.
const SUPPORTED_KEY_ALGORITHM = "RSA-OAEP-256";
const SUPPORTED_CONTENT_ENCRYPTION = "A256GCM";
const CEK_LENGTH_BYTES = 32;
const GCM_IV_LENGTH_BYTES = 12;
const GCM_TAG_LENGTH_BYTES = 16;

/**
 * Parses an RSA private key given either as PEM or as base64 encoded PKCS#8 DER
 * (the format of `encryption.client_private_key` in a Credential Store binding).
 */
export function parseRsaPrivateKey(key: string): KeyObject {
  const trimmed = key.trim();
  const keyObject = trimmed.startsWith("-----BEGIN")
    ? createPrivateKey(trimmed)
    : createPrivateKey({ key: Buffer.from(trimmed, "base64"), format: "der", type: "pkcs8" });

  if (keyObject.asymmetricKeyType !== "rsa") {
    throw new Error(`Expected an RSA private key, got "${keyObject.asymmetricKeyType}"`);
  }
  return keyObject;
}

/**
 * Decrypts a JWE in compact serialization that uses RSA-OAEP-256 key encryption and A256GCM content encryption.
 * Any other algorithm combination is rejected.
 * @returns the decrypted plaintext as UTF-8 string
 */
export function decryptJwe(compactJwe: string, privateKey: KeyObject): string {
  const parts = compactJwe.trim().split(".");
  if (parts.length !== 5) {
    throw new Error("Invalid JWE: expected compact serialization with 5 parts");
  }
  const [protectedHeader, encryptedKey, iv, ciphertext, tag] = parts as [string, string, string, string, string];

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(protectedHeader, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JWE: protected header is not valid JSON");
  }

  if (header.alg !== SUPPORTED_KEY_ALGORITHM || header.enc !== SUPPORTED_CONTENT_ENCRYPTION) {
    throw new Error(
      `Unsupported JWE algorithms alg="${String(header.alg)}", enc="${String(header.enc)}" (expected ${SUPPORTED_KEY_ALGORITHM} / ${SUPPORTED_CONTENT_ENCRYPTION})`,
    );
  }
  if (header.zip !== undefined || header.crit !== undefined) {
    throw new Error('Unsupported JWE: "zip" and "crit" header parameters are not supported');
  }

  const contentEncryptionKey = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(encryptedKey, "base64url"),
  );
  const ivBytes = Buffer.from(iv, "base64url");
  const tagBytes = Buffer.from(tag, "base64url");
  if (
    contentEncryptionKey.length !== CEK_LENGTH_BYTES ||
    ivBytes.length !== GCM_IV_LENGTH_BYTES ||
    tagBytes.length !== GCM_TAG_LENGTH_BYTES
  ) {
    throw new Error("Invalid JWE: unexpected key, IV or authentication tag length");
  }

  const decipher = createDecipheriv("aes-256-gcm", contentEncryptionKey, ivBytes, {
    authTagLength: GCM_TAG_LENGTH_BYTES,
  });
  // RFC 7516 5.2: the additional authenticated data is the ASCII of the encoded protected header
  decipher.setAAD(Buffer.from(protectedHeader, "ascii"));
  decipher.setAuthTag(tagBytes);

  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
