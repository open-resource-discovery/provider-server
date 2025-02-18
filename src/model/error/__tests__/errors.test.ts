import { describe, it, expect } from "@jest/globals";
import { InternalServerError } from "src/model/error/InternalServerError.js";
import { NotFoundError } from "src/model/error/NotFoundError.js";
import { UnauthorizedError } from "src/model/error/UnauthorizedError.js";

describe("Error Classes", () => {
  describe("BackendError", () => {
    it("should create error with basic properties", () => {
      const error = new InternalServerError("Test error");
      expect(error.message).toBe("Test error");
      expect(error.getHttpStatusCode()).toBe(500);
    });

    it("should create error with details", () => {
      const error = new InternalServerError("Test error", "test-target", [
        { code: "DETAIL", message: "Detail message" },
      ]);
      const response = error.getErrorResponse();
      expect(response.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(response.error.target).toBe("test-target");
      expect(response.error.message).toBe("Test error");
      expect(response.error.details).toHaveLength(1);
    });
  });

  describe("Specific Error Classes", () => {
    it("should create NotFoundError with correct status", () => {
      const error = new NotFoundError("Resource not found");
      expect(error.getHttpStatusCode()).toBe(404);
    });

    it("should create UnauthorizedError with correct status", () => {
      const error = new UnauthorizedError("Unauthorized access");
      expect(error.getHttpStatusCode()).toBe(401);
    });

    it("should create InternalServerError with correct status", () => {
      const error = new InternalServerError("Server error");
      expect(error.getHttpStatusCode()).toBe(500);
    });
  });
});
