import { generateKeyPairSync, KeyObject } from "node:crypto";
import { decryptJwe, parseRsaPrivateKey } from "../jwe.js";
import { encryptJwe } from "../../__tests__/helpers/jwe.js";

describe("jwe", () => {
  let publicKey: KeyObject;
  let privateKey: KeyObject;

  beforeAll(() => {
    ({ publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 }));
  });

  describe("parseRsaPrivateKey", () => {
    it("should parse a base64 encoded PKCS#8 DER key as provided in the Credential Store binding", () => {
      const der = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

      expect(parseRsaPrivateKey(der).asymmetricKeyType).toBe("rsa");
    });

    it("should parse a PEM key", () => {
      const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

      expect(parseRsaPrivateKey(pem).asymmetricKeyType).toBe("rsa");
    });

    it("should reject non RSA keys", () => {
      const ecKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
      const pem = ecKey.export({ format: "pem", type: "pkcs8" }).toString();

      expect(() => parseRsaPrivateKey(pem)).toThrow("Expected an RSA private key");
    });

    it("should reject invalid keys", () => {
      expect(() => parseRsaPrivateKey("bm90LWEta2V5")).toThrow();
    });
  });

  describe("decryptJwe", () => {
    it("should decrypt a RSA-OAEP-256 / A256GCM encrypted payload", () => {
      const payload = JSON.stringify({ name: "GITHUB_TOKEN", value: "ghp_äöü-🔑" });

      expect(decryptJwe(encryptJwe(payload, publicKey), privateKey)).toBe(payload);
    });

    it.each([
      ["RSA-OAEP", "A256GCM"],
      ["RSA-OAEP-256", "A128GCM"],
      ["dir", "A256GCM"],
    ])("should reject alg=%s enc=%s", (alg, enc) => {
      const jwe = encryptJwe("{}", publicKey, { alg, enc });

      expect(() => decryptJwe(jwe, privateKey)).toThrow("Unsupported JWE algorithms");
    });

    it("should reject compressed payloads", () => {
      const jwe = encryptJwe("{}", publicKey, { alg: "RSA-OAEP-256", enc: "A256GCM", zip: "DEF" });

      expect(() => decryptJwe(jwe, privateKey)).toThrow('"zip" and "crit"');
    });

    it("should reject payloads that are not in compact serialization", () => {
      expect(() => decryptJwe("a.b.c", privateKey)).toThrow("expected compact serialization with 5 parts");
    });

    it("should reject a tampered ciphertext", () => {
      const parts = encryptJwe('{"value":"secret"}', publicKey).split(".");
      const ciphertext = Buffer.from(parts[3] as string, "base64url");
      ciphertext[0] = (ciphertext[0] as number) ^ 0xff;
      parts[3] = ciphertext.toString("base64url");

      expect(() => decryptJwe(parts.join("."), privateKey)).toThrow();
    });

    it("should reject a tampered protected header", () => {
      const parts = encryptJwe("{}", publicKey).split(".");
      parts[0] = Buffer.from(JSON.stringify({ alg: "RSA-OAEP-256", enc: "A256GCM", iat: 1 })).toString("base64url");

      expect(() => decryptJwe(parts.join("."), privateKey)).toThrow();
    });

    it("should fail with a different private key", () => {
      const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

      expect(() => decryptJwe(encryptJwe("{}", publicKey), otherKey)).toThrow();
    });
  });
});
