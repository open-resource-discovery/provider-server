import { DocumentRouter } from "../documentRouter.js";
import { DocumentService } from "../../services/interfaces/documentService.js";
import { FqnDocumentMap } from "../../util/fqnHelpers.js";
import { OptAuthMethod } from "../../model/cli.js";
import { PATH_CONSTANTS } from "../../constant.js";
import { FastifyInstanceType } from "../../model/fastify.js";

// Mock dependencies
jest.mock("../../util/logger.js", () => ({
  log: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("../../util/fqnHelpers.js", () => ({
  ...jest.requireActual("../../util/fqnHelpers.js"),
  isOrdId: jest.fn(),
}));

jest.mock("../../util/pathUtils.js", () => ({
  ...jest.requireActual("../../util/pathUtils.js"),
  ordIdToPathSegment: jest.fn((ordId: string) => ordId.replace(/:/g, "_")),
  joinFilePaths: jest.fn((...segments: string[]) => segments.join("/")),
}));

describe("DocumentRouter", () => {
  let mockDocumentService: jest.Mocked<DocumentService>;
  let mockFastify: jest.Mocked<FastifyInstanceType>;
  let documentRouter: DocumentRouter;
  const baseUrl = "http://example.com";

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock document service
    mockDocumentService = {
      getProcessedDocument: jest.fn(),
      getFileContent: jest.fn(),
      getOrdConfiguration: jest.fn(),
    } as unknown as jest.Mocked<DocumentService>;

    // Create mock Fastify instance
    mockFastify = {
      get: jest.fn(),
    } as unknown as jest.Mocked<FastifyInstanceType>;

    const fqnDocumentMap: FqnDocumentMap = {
      "urn:apiResource:example:v1": [
        { fileName: "api-spec.json", filePath: "resources/urn_apiResource_example_v1/api-spec.json" },
      ],
    };

    documentRouter = new DocumentRouter(mockDocumentService, {
      baseUrl,
      authMethods: [OptAuthMethod.Open],
      fqnDocumentMap,
    });
  });

  describe("register", () => {
    it("should register all required routes", () => {
      documentRouter.register(mockFastify);

      // Check that routes are registered
      expect(mockFastify.get).toHaveBeenCalledWith(
        expect.stringContaining(`${PATH_CONSTANTS.SERVER_PREFIX}/${PATH_CONSTANTS.DOCUMENTS_SUBDIRECTORY}/*`),
        expect.any(Function),
      );
      expect(mockFastify.get).toHaveBeenCalledWith(
        expect.stringContaining(`${PATH_CONSTANTS.SERVER_PREFIX}/:fileName`),
        expect.any(Function),
      );
      expect(mockFastify.get).toHaveBeenCalledWith(
        expect.stringContaining(`${PATH_CONSTANTS.SERVER_PREFIX}/:ordId/*`),
        expect.any(Function),
      );
    });
  });

  describe("resource file endpoint /:ordId/*", () => {
    let resourceHandler: (...args: unknown[]) => unknown;

    beforeEach(() => {
      documentRouter.register(mockFastify);
      // Get the handler for the /:ordId/* route
      const calls = mockFastify.get.mock.calls;
      const resourceCall = calls.find((call: unknown[]) => typeof call[0] === "string" && call[0].includes(":ordId/*"));
      resourceHandler = resourceCall?.[1] as unknown as (...args: unknown[]) => unknown;

      if (!resourceHandler) {
        throw new Error("Resource handler not found in mock calls");
      }
    });

    it("should use ordIdToPathSegment when ordId is a valid ORD ID", async () => {
      const { isOrdId } = jest.requireMock("../../util/fqnHelpers.js");
      const { ordIdToPathSegment, joinFilePaths } = jest.requireMock("../../util/pathUtils.js");
      isOrdId.mockReturnValue(true);
      mockDocumentService.getFileContent.mockResolvedValue(Buffer.from("test content"));

      const mockRequest = {
        params: {
          "ordId": "urn:apiResource:example:v1",
          "*": "openapi.json",
        },
      };
      const mockReply = {
        send: jest.fn().mockReturnThis(),
        type: jest.fn().mockReturnThis(),
        code: jest.fn().mockReturnThis(),
        callNotFound: jest.fn(),
      };

      await resourceHandler(mockRequest, mockReply);

      expect(isOrdId).toHaveBeenCalledWith("urn:apiResource:example:v1");
      expect(ordIdToPathSegment).toHaveBeenCalledWith("urn:apiResource:example:v1");
      expect(joinFilePaths).toHaveBeenCalledWith("urn_apiResource_example_v1", "openapi.json");
      expect(mockDocumentService.getFileContent).toHaveBeenCalledWith("urn_apiResource_example_v1/openapi.json");
    });

    it("should NOT use ordIdToPathSegment when ordId is not a valid ORD ID", async () => {
      const { isOrdId } = jest.requireMock("../../util/fqnHelpers.js");
      const { ordIdToPathSegment, joinFilePaths } = jest.requireMock("../../util/pathUtils.js");
      isOrdId.mockReturnValue(false);
      mockDocumentService.getFileContent.mockResolvedValue(Buffer.from("test content"));

      const mockRequest = {
        params: {
          "ordId": "regular-path",
          "*": "file.json",
        },
      };
      const mockReply = {
        send: jest.fn().mockReturnThis(),
        type: jest.fn().mockReturnThis(),
        code: jest.fn().mockReturnThis(),
        callNotFound: jest.fn(),
      };

      await resourceHandler(mockRequest, mockReply);

      expect(isOrdId).toHaveBeenCalledWith("regular-path");
      expect(ordIdToPathSegment).not.toHaveBeenCalled();
      expect(joinFilePaths).toHaveBeenCalledWith("regular-path", "file.json");
      expect(mockDocumentService.getFileContent).toHaveBeenCalledWith("regular-path/file.json");
    });

    it("should use resource map when available", async () => {
      const { isOrdId } = jest.requireMock("../../util/fqnHelpers.js");
      isOrdId.mockReturnValue(true);
      mockDocumentService.getFileContent.mockResolvedValue(Buffer.from("test content"));

      const mockRequest = {
        params: {
          "ordId": "urn:apiResource:example:v1",
          "*": "api-spec.json",
        },
      };
      const mockReply = {
        send: jest.fn().mockReturnThis(),
        type: jest.fn().mockReturnThis(),
        code: jest.fn().mockReturnThis(),
        callNotFound: jest.fn(),
      };

      await resourceHandler(mockRequest, mockReply);

      // Should use the mapped file path from fqnDocumentMap
      expect(mockDocumentService.getFileContent).toHaveBeenCalledWith(
        "resources/urn_apiResource_example_v1/api-spec.json",
      );
    });

    it("should handle JSON files correctly", async () => {
      const { isOrdId } = jest.requireMock("../../util/fqnHelpers.js");
      isOrdId.mockReturnValue(true);
      const jsonContent = { test: "data" };
      mockDocumentService.getFileContent.mockResolvedValue(Buffer.from(JSON.stringify(jsonContent)));

      const mockRequest = {
        params: {
          "ordId": "urn:eventResource:example:v1",
          "*": "schema.json",
        },
      };
      const mockReply = {
        send: jest.fn().mockReturnThis(),
        type: jest.fn().mockReturnThis(),
        code: jest.fn().mockReturnThis(),
        callNotFound: jest.fn(),
      };

      await resourceHandler(mockRequest, mockReply);

      expect(mockReply.type).toHaveBeenCalledWith("application/json");
      expect(mockReply.send).toHaveBeenCalledWith(jsonContent);
    });

    it("should handle non-JSON files correctly", async () => {
      const { isOrdId } = jest.requireMock("../../util/fqnHelpers.js");
      isOrdId.mockReturnValue(true);
      const textContent = Buffer.from("Plain text content");
      mockDocumentService.getFileContent.mockResolvedValue(textContent);

      const mockRequest = {
        params: {
          "ordId": "urn:apiResource:example:v1",
          "*": "readme.txt",
        },
      };
      const mockReply = {
        send: jest.fn().mockReturnThis(),
        type: jest.fn().mockReturnThis(),
        code: jest.fn().mockReturnThis(),
        callNotFound: jest.fn(),
      };

      await resourceHandler(mockRequest, mockReply);

      expect(mockReply.type).not.toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith(textContent);
    });

    it("should handle errors properly", async () => {
      const { isOrdId } = jest.requireMock("../../util/fqnHelpers.js");
      const { ordIdToPathSegment, joinFilePaths } = jest.requireMock("../../util/pathUtils.js");

      isOrdId.mockReturnValue(true);
      const error = new Error("File not found");
      mockDocumentService.getFileContent.mockRejectedValue(error);

      const mockRequest = {
        params: {
          "ordId": "urn:apiResource:example:v1",
          "*": "missing.json",
        },
      };
      const mockReply = {
        send: jest.fn().mockReturnThis(),
        type: jest.fn().mockReturnThis(),
        code: jest.fn().mockReturnThis(),
        callNotFound: jest.fn(),
      };

      await expect(resourceHandler(mockRequest, mockReply)).resolves.not.toThrow();

      expect(isOrdId).toHaveBeenCalledWith("urn:apiResource:example:v1");
      expect(ordIdToPathSegment).toHaveBeenCalledWith("urn:apiResource:example:v1");
      expect(joinFilePaths).toHaveBeenCalledWith("urn_apiResource_example_v1", "missing.json");
      expect(mockDocumentService.getFileContent).toHaveBeenCalledWith("urn_apiResource_example_v1/missing.json");

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: "INTERNAL_SERVER_ERROR",
          }),
        }),
      );
    });
  });
});
