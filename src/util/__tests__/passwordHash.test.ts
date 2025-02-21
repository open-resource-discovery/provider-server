import { isBcryptHash } from "../passwordHash.js";

describe("passwordHash", () => {
  describe("isBcryptHash", () => {
    it("should return true for valid bcrypt hash", () => {
      const validHash = "$2y$05$TjeC./ljKi7VLTBbzjTVyOi6lQBYpzfXiZSfJiGECHVi0eEN6/QG.";
      expect(isBcryptHash(validHash)).toBe(true);
    });

    it("should return false for invalid hash", () => {
      const invalidHash = "not-a-hash";
      expect(isBcryptHash(invalidHash)).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isBcryptHash("")).toBe(false);
    });
  });
});
