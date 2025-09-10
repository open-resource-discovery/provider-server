import { FastifyReply, FastifyRequest } from "fastify";
import { createBasicAuthValidator } from "../basicAuthValidation.js";
import { UnauthorizedError } from "../../model/error/UnauthorizedError.js";
import { comparePassword } from "../../util/passwordHash.js";
import { log } from "../../util/logger.js";

jest.mock("../../util/passwordHash.js");
jest.mock("../../util/logger.js");

describe("basicAuthValidation", () => {
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;
  const mockComparePassword = comparePassword as jest.MockedFunction<typeof comparePassword>;
  const mockLog = log as jest.Mocked<typeof log>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest = {};
    mockReply = {};
    mockLog.error = jest.fn();
  });

  describe("createBasicAuthValidator", () => {
    it("should validate successfully with correct credentials", async () => {
      const validUsers = { testuser: "hashedPassword123" };
      const validator = createBasicAuthValidator(validUsers);

      mockComparePassword.mockResolvedValue(true);

      await expect(
        validator("testuser", "password123", mockRequest as FastifyRequest, mockReply as FastifyReply),
      ).resolves.toBeUndefined();

      expect(mockComparePassword).toHaveBeenCalledWith("password123", "hashedPassword123");
      expect(mockLog.error).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedError for invalid password", async () => {
      const validUsers = { testuser: "hashedPassword123" };
      const validator = createBasicAuthValidator(validUsers);

      mockComparePassword.mockResolvedValue(false);

      await expect(
        validator("testuser", "wrongpassword", mockRequest as FastifyRequest, mockReply as FastifyReply),
      ).rejects.toThrow(UnauthorizedError);

      expect(mockComparePassword).toHaveBeenCalledWith("wrongpassword", "hashedPassword123");
      expect(mockLog.error).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedError for non-existent user", async () => {
      const validUsers = { testuser: "hashedPassword123" };
      const validator = createBasicAuthValidator(validUsers);

      mockComparePassword.mockResolvedValue(false);

      await expect(
        validator("nonexistent", "password", mockRequest as FastifyRequest, mockReply as FastifyReply),
      ).rejects.toThrow(UnauthorizedError);

      expect(mockComparePassword).toHaveBeenCalledWith("password", undefined);
    });

    it("should handle empty username", async () => {
      const validUsers = { testuser: "hashedPassword123" };
      const validator = createBasicAuthValidator(validUsers);

      mockComparePassword.mockResolvedValue(false);

      await expect(validator("", "password", mockRequest as FastifyRequest, mockReply as FastifyReply)).rejects.toThrow(
        UnauthorizedError,
      );

      expect(mockComparePassword).toHaveBeenCalledWith("password", undefined);
    });

    it("should handle empty password", async () => {
      const validUsers = { testuser: "hashedPassword123" };
      const validator = createBasicAuthValidator(validUsers);

      mockComparePassword.mockResolvedValue(false);

      await expect(validator("testuser", "", mockRequest as FastifyRequest, mockReply as FastifyReply)).rejects.toThrow(
        UnauthorizedError,
      );

      expect(mockComparePassword).toHaveBeenCalledWith("", "hashedPassword123");
    });

    it("should handle comparePassword throwing an error", async () => {
      const validUsers = { testuser: "hashedPassword123" };
      const validator = createBasicAuthValidator(validUsers);

      const compareError = new Error("Compare failed");
      mockComparePassword.mockRejectedValue(compareError);

      await expect(
        validator("testuser", "password", mockRequest as FastifyRequest, mockReply as FastifyReply),
      ).rejects.toThrow(UnauthorizedError);

      expect(mockLog.error).toHaveBeenCalledWith(compareError);
    });

    it("should not log UnauthorizedError", async () => {
      const validUsers = { testuser: "hashedPassword123" };
      const validator = createBasicAuthValidator(validUsers);

      mockComparePassword.mockRejectedValue(new UnauthorizedError("Already unauthorized"));

      await expect(
        validator("testuser", "password", mockRequest as FastifyRequest, mockReply as FastifyReply),
      ).rejects.toThrow(UnauthorizedError);

      expect(mockLog.error).not.toHaveBeenCalled();
    });

    it("should handle multiple users", async () => {
      const validUsers = {
        user1: "hash1",
        user2: "hash2",
        user3: "hash3",
      };
      const validator = createBasicAuthValidator(validUsers);

      mockComparePassword.mockResolvedValue(true);

      await expect(
        validator("user2", "password", mockRequest as FastifyRequest, mockReply as FastifyReply),
      ).resolves.toBeUndefined();

      expect(mockComparePassword).toHaveBeenCalledWith("password", "hash2");
    });

    it("should handle empty validUsers object", async () => {
      const validUsers = {};
      const validator = createBasicAuthValidator(validUsers);

      mockComparePassword.mockResolvedValue(false);

      await expect(
        validator("anyuser", "password", mockRequest as FastifyRequest, mockReply as FastifyReply),
      ).rejects.toThrow(UnauthorizedError);

      expect(mockComparePassword).toHaveBeenCalledWith("password", undefined);
    });
  });
});
