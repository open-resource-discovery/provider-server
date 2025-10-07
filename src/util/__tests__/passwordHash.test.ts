import { isBcryptHash, comparePassword } from "../passwordHash.js";
import bcrypt from "bcryptjs";

// Mock bcryptjs
jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
}));

const mockCompare = bcrypt.compare as jest.MockedFunction<(password: string, hash: string) => Promise<boolean>>;

describe("passwordHash", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("isBcryptHash", () => {
    it("should return true for valid $2y bcrypt hash", () => {
      const validHash = "$2y$05$TjeC./ljKi7VLTBbzjTVyOi6lQBYpzfXiZSfJiGECHVi0eEN6/QG.";
      expect(isBcryptHash(validHash)).toBe(true);
    });

    it("should return true for valid $2a bcrypt hash", () => {
      const validHash = "$2a$10$N9qo8uLOickgx2ZMRZoMye/2Q2b6CY3J2F7f3pY3sE/fOZ3/2C2xG";
      expect(isBcryptHash(validHash)).toBe(true);
    });

    it("should return true for valid $2b bcrypt hash", () => {
      const validHash = "$2b$12$uuKCRhf5qzD4VyC7pKQhSu6T8sGKBZJ3X3Z8sWVq4WRN3YzL7dR7y";
      expect(isBcryptHash(validHash)).toBe(true);
    });

    it("should return false for invalid hash format", () => {
      const invalidHash = "not-a-hash";
      expect(isBcryptHash(invalidHash)).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isBcryptHash("")).toBe(false);
    });

    it("should return false for hash with wrong prefix", () => {
      const invalidHash = "$3a$10$N9qo8uLOickgx2ZMRZoMye/2Q2b6CY3J2F7f3pY3sE/fOZ3/2C2xG";
      expect(isBcryptHash(invalidHash)).toBe(false);
    });

    it("should return false for hash with wrong length", () => {
      const tooShort = "$2a$10$shortHash";
      expect(isBcryptHash(tooShort)).toBe(false);
    });

    it("should return false for hash with invalid characters", () => {
      const invalidChars = "$2a$10$N9qo8uLOickgx2ZMRZoMye/2Q2b6CY3J2F7f3pY3sE/fOZ3/2C2@#";
      expect(isBcryptHash(invalidChars)).toBe(false);
    });

    it("should return false for hash with wrong rounds format", () => {
      const invalidRounds = "$2a$1$N9qo8uLOickgx2ZMRZoMye/2Q2b6CY3J2F7f3pY3sE/fOZ3/2C2xG";
      expect(isBcryptHash(invalidRounds)).toBe(false);
    });
  });

  describe("comparePassword", () => {
    it("should return true when password matches $2a hash", async () => {
      const password = "mySecretPassword";
      const hash = "$2a$10$hashedPassword";

      mockCompare.mockResolvedValue(true);

      const result = await comparePassword(password, hash);

      expect(result).toBe(true);
      expect(mockCompare).toHaveBeenCalledWith(password, hash);
    });

    it("should return true when password matches $2y hash (converted to $2a)", async () => {
      const password = "mySecretPassword";
      const hash = "$2y$10$hashedPassword";

      mockCompare.mockResolvedValue(true);

      const result = await comparePassword(password, hash);

      expect(result).toBe(true);
      expect(mockCompare).toHaveBeenCalledWith(password, "$2a$10$hashedPassword");
    });

    it("should return false when password does not match hash", async () => {
      const password = "wrongPassword";
      const hash = "$2a$10$hashedPassword";

      mockCompare.mockResolvedValue(false);

      const result = await comparePassword(password, hash);

      expect(result).toBe(false);
      expect(mockCompare).toHaveBeenCalledWith(password, hash);
    });

    it("should throw error when password is empty", async () => {
      const password = "";
      const hash = "$2a$10$hashedPassword";

      await expect(comparePassword(password, hash)).rejects.toThrow("Password and hashed password are required");
    });

    it("should throw error when password is null/undefined", async () => {
      const hash = "$2a$10$hashedPassword";

      await expect(comparePassword(null as unknown as string, hash)).rejects.toThrow(
        "Password and hashed password are required",
      );
      await expect(comparePassword(undefined as unknown as string, hash)).rejects.toThrow(
        "Password and hashed password are required",
      );
    });

    it("should throw error when hashedPassword is empty", async () => {
      const password = "myPassword";
      const hash = "";

      await expect(comparePassword(password, hash)).rejects.toThrow("Password and hashed password are required");
    });

    it("should throw error when hashedPassword is null/undefined", async () => {
      const password = "myPassword";

      await expect(comparePassword(password, null as unknown as string)).rejects.toThrow(
        "Password and hashed password are required",
      );
      await expect(comparePassword(password, undefined as unknown as string)).rejects.toThrow(
        "Password and hashed password are required",
      );
    });

    it("should handle bcrypt comparison errors", async () => {
      const password = "myPassword";
      const hash = "$2a$10$hashedPassword";
      const bcryptError = new Error("Bcrypt comparison failed");

      mockCompare.mockRejectedValue(bcryptError);

      await expect(comparePassword(password, hash)).rejects.toThrow("Bcrypt comparison failed");
    });

    it("should handle $2b hashes without conversion", async () => {
      const password = "mySecretPassword";
      const hash = "$2b$10$hashedPassword";

      mockCompare.mockResolvedValue(true);

      const result = await comparePassword(password, hash);

      expect(result).toBe(true);
      expect(mockCompare).toHaveBeenCalledWith(password, hash);
    });

    it("should handle multiple $2y prefixes in hash", async () => {
      const password = "myPassword";
      const hash = "$2y$2y$10$hashedPassword";

      mockCompare.mockResolvedValue(true);

      const result = await comparePassword(password, hash);

      expect(result).toBe(true);
      // Should only replace the first occurrence
      expect(mockCompare).toHaveBeenCalledWith(password, "$2a$2y$10$hashedPassword");
    });
  });
});
