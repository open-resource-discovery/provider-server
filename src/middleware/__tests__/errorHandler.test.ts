import { FastifyReply, FastifyRequest } from "fastify";
import { errorHandler } from "../errorHandler.js";
import { InternalServerError } from "../../model/error/InternalServerError.js";
import { UnauthorizedError } from "../../model/error/UnauthorizedError.js";
import { ValidationError } from "../../model/error/ValidationError.js";
import { NotFoundError } from "../../model/error/NotFoundError.js";

describe("errorHandler", () => {
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;
  let mockLog: { error: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockLog = { error: jest.fn() };
    mockRequest = {
      log: mockLog as unknown as FastifyRequest["log"],
    };

    mockReply = {
      code: jest.fn().mockReturnThis(),
      header: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
  });

  describe("BackendError instances", () => {
    it("should handle BackendError directly without casting", () => {
      const error = new ValidationError("Validation failed", []);

      errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.header).toHaveBeenCalledWith("Content-Type", "application/json; charset=utf-8");
      expect(mockReply.send).toHaveBeenCalledWith(error.getErrorResponse());
      expect(mockLog.error).toHaveBeenCalledWith(`ERROR 400: ${JSON.stringify(error.getErrorResponse())}`);
    });

    it("should handle NotFoundError", () => {
      const error = new NotFoundError("Resource not found");

      errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(404);
      expect(mockReply.send).toHaveBeenCalledWith(error.getErrorResponse());
      expect(mockLog.error).toHaveBeenCalledWith(`ERROR 404: ${JSON.stringify(error.getErrorResponse())}`);
    });

    it("should handle UnauthorizedError", () => {
      const error = new UnauthorizedError("Not authorized");

      errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith(error.getErrorResponse());
      expect(mockLog.error).toHaveBeenCalledWith(`ERROR 401: ${JSON.stringify(error.getErrorResponse())}`);
    });

    it("should handle InternalServerError", () => {
      const error = new InternalServerError("Server error");

      errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith(error.getErrorResponse());
      expect(mockLog.error).toHaveBeenCalledWith(`ERROR 500: ${JSON.stringify(error.getErrorResponse())}`);
    });
  });

  describe("Fastify auth errors", () => {
    it("should convert Fastify 401 auth error to UnauthorizedError", () => {
      const fastifyAuthError = new Error("Missing authorization") as Error & {
        statusCode: number;
        code: string;
        name: string;
      };
      fastifyAuthError.statusCode = 401;
      fastifyAuthError.code = "FST_BASIC_AUTH_MISSING_OR_BAD_AUTHORIZATION_HEADER";
      fastifyAuthError.name = "FastifyError";

      errorHandler(fastifyAuthError, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Unauthorized",
          }),
        }),
      );
    });

    it("should not convert non-auth 401 errors", () => {
      const otherError = new Error("Some other error") as Error & {
        statusCode: number;
        code: string;
        name: string;
      };
      otherError.statusCode = 401;
      otherError.code = "DIFFERENT_CODE";
      otherError.name = "FastifyError";

      errorHandler(otherError, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Internal Server error: Some other error",
          }),
        }),
      );
    });
  });

  describe("Generic Error instances", () => {
    it("should convert generic Error to InternalServerError", () => {
      const genericError = new Error("Something went wrong");

      errorHandler(genericError, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Internal Server error: Something went wrong",
          }),
        }),
      );
    });

    it("should handle TypeError", () => {
      const typeError = new TypeError("Cannot read property of undefined");

      errorHandler(typeError, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Internal Server error: Cannot read property of undefined",
          }),
        }),
      );
    });

    it("should handle ReferenceError", () => {
      const refError = new ReferenceError("Variable is not defined");

      errorHandler(refError, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Internal Server error: Variable is not defined",
          }),
        }),
      );
    });
  });

  describe("Non-Error throws", () => {
    it("should handle string throws", () => {
      const stringThrow = "Something bad happened";

      errorHandler(stringThrow, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Unsupported throw use.",
          }),
        }),
      );
    });

    it("should handle number throws", () => {
      const numberThrow = 404;

      errorHandler(numberThrow, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Unsupported throw use.",
          }),
        }),
      );
    });

    it("should handle object throws", () => {
      const objectThrow = { error: "custom error object" };

      errorHandler(objectThrow, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Unsupported throw use.",
          }),
        }),
      );
    });

    it("should handle null throws", () => {
      errorHandler(null, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Unsupported throw use.",
          }),
        }),
      );
    });

    it("should handle undefined throws", () => {
      errorHandler(undefined, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Unsupported throw use.",
          }),
        }),
      );
    });
  });

  describe("Response structure", () => {
    it("should always set correct Content-Type header", () => {
      const error = new ValidationError("Test", []);

      errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.header).toHaveBeenCalledWith("Content-Type", "application/json; charset=utf-8");
    });

    it("should always log errors with correct format", () => {
      const error = new NotFoundError("Not found");

      errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockLog.error).toHaveBeenCalledTimes(1);
      expect(mockLog.error).toHaveBeenCalledWith(`ERROR 404: ${JSON.stringify(error.getErrorResponse())}`);
    });

    it("should chain reply methods correctly", () => {
      const error = new ValidationError("Test", []);

      errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

      // Verify all methods were called
      expect(mockReply.code).toHaveBeenCalled();
      expect(mockReply.header).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalled();
    });
  });
});
