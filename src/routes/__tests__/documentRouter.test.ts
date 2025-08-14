import { DocumentRouter } from "../documentRouter.js";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DocumentService } from "../../services/interfaces/documentService.js";
import { ORDDocument, ORDConfiguration } from "@open-resource-discovery/specification";
import { FqnDocumentMap } from "../../util/fqnHelpers.js";
import { OptAuthMethod } from "../../model/cli.js";
import { NotFoundError } from "../../model/error/NotFoundError.js";
import { InternalServerError } from "../../model/error/InternalServerError.js";
import { log } from "../../util/logger.js";
import { FastifyInstanceType } from "../../model/fastify.js";

jest.mock("../../util/logger.js");

describe("DocumentRouter", () => {
  let documentRouter: DocumentRouter;
  let mockDocumentService: jest.Mocked<DocumentService>;
  let mockFastify: jest.Mocked<FastifyInstance>;
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: jest.Mocked<FastifyReply>;
  let mockFqnMap: FqnDocumentMap;

  const mockOrdConfig: ORDConfiguration = {
    $schema: "https://github.com/open-resource-discovery/spec-v1/interfaces/Configuration.schema.json",
    openResourceDiscoveryV1: {
      documents: [
        {
          url: "/documents/test.json",
        },
      ],
    },
  } as unknown as ORDConfiguration;

  const mockOrdDocument: ORDDocument = {
    $schema: "https://github.com/open-resource-discovery/spec-v1/interfaces/Document.schema.json",
    openResourceDiscovery: "1.9",
    description: "Test document",
  } as unknown as ORDDocument;

  beforeEach(() => {
    jest.clearAllMocks();

    mockFqnMap = {
      "sap.test:apiResource:TestAPI:v1": [
        {
          fileName: "api-v1.yaml",
          filePath: "apis/test-api/v1/api.yaml",
        },
      ],
      "sap.test:package:TestPackage:v1": [
        {
          fileName: "package.json",
          filePath: "packages/test/package.json",
        },
      ],
    };

    mockDocumentService = {
      getOrdConfiguration: jest.fn().mockResolvedValue(mockOrdConfig),
      getProcessedDocument: jest.fn().mockResolvedValue(mockOrdDocument),
      getFileContent: jest.fn().mockResolvedValue(Buffer.from("file content")),
    } as unknown as jest.Mocked<DocumentService>;

    mockFastify = {
      get: jest.fn(),
    } as unknown as jest.Mocked<FastifyInstance>;

    mockRequest = {
      params: {},
    };

    mockReply = {
      send: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      code: jest.fn().mockReturnThis(),
      callNotFound: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<FastifyReply>;

    documentRouter = new DocumentRouter(mockDocumentService, {
      baseUrl: "http://localhost:3000",
      authMethods: [OptAuthMethod.Basic],
      fqnDocumentMap: mockFqnMap,
      documentsSubDirectory: "documents",
    });
  });

  describe("constructor", () => {
    it("should use default documents subdirectory if not provided", () => {
      const router = new DocumentRouter(mockDocumentService, {
        baseUrl: "http://localhost:3000",
        authMethods: [],
        fqnDocumentMap: {},
      });

      expect(router).toBeDefined();
    });
  });

  describe("register", () => {
    it("should register all required routes", () => {
      documentRouter.register(mockFastify as unknown as FastifyInstanceType);

      expect(mockFastify.get).toHaveBeenCalledTimes(4);
      expect(mockFastify.get).toHaveBeenCalledWith("/.well-known/open-resource-discovery", expect.any(Function));
      expect(mockFastify.get).toHaveBeenCalledWith("/ord/v1/documents/*", expect.any(Function));
      expect(mockFastify.get).toHaveBeenCalledWith("/ord/v1/:fileName", expect.any(Function));
      expect(mockFastify.get).toHaveBeenCalledWith("/ord/v1/:ordId/*", expect.any(Function));
    });
  });

  describe("documents endpoint", () => {
    let handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

    beforeEach(() => {
      documentRouter.register(mockFastify as unknown as FastifyInstanceType);
      const routeCall = mockFastify.get.mock.calls.find((call) => call[0] === "/ord/v1/documents/*");
      handler = routeCall?.[1] as unknown as (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    });

    it("should serve document with .json extension", async () => {
      mockRequest.params = { "*": "test.json" };

      await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockDocumentService.getProcessedDocument).toHaveBeenCalledWith("documents/test.json");
      expect(mockReply.send).toHaveBeenCalledWith(mockOrdDocument);
    });

    it("should add .json extension if missing", async () => {
      mockRequest.params = { "*": "test" };

      await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockDocumentService.getProcessedDocument).toHaveBeenCalledWith("documents/test.json");
      expect(mockReply.send).toHaveBeenCalledWith(mockOrdDocument);
    });

    it("should handle nested document paths", async () => {
      mockRequest.params = { "*": "subfolder/test.json" };

      await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockDocumentService.getProcessedDocument).toHaveBeenCalledWith("documents/subfolder/test.json");
    });

    it("should propagate NotFoundError", async () => {
      const error = new NotFoundError("Document not found");
      mockDocumentService.getProcessedDocument.mockRejectedValue(error);
      mockRequest.params = { "*": "missing.json" };

      await expect(handler(mockRequest as FastifyRequest, mockReply)).rejects.toThrow(error);
      expect(log.error).toHaveBeenCalled();
    });

    it("should wrap generic errors in InternalServerError", async () => {
      const error = new Error("Generic error");
      mockDocumentService.getProcessedDocument.mockRejectedValue(error);
      mockRequest.params = { "*": "error.json" };

      await expect(handler(mockRequest as FastifyRequest, mockReply)).rejects.toThrow(InternalServerError);
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe("root files endpoint", () => {
    let handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

    beforeEach(() => {
      documentRouter.register(mockFastify as unknown as FastifyInstanceType);
      const routeCall = mockFastify.get.mock.calls.find((call) => call[0] === "/ord/v1/:fileName");
      handler = routeCall?.[1] as unknown as (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    });

    it("should serve root JSON file", async () => {
      const jsonContent = { test: "data" };
      mockDocumentService.getFileContent.mockResolvedValue(Buffer.from(JSON.stringify(jsonContent)));
      mockRequest.params = { fileName: "config.json" };

      await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockDocumentService.getFileContent).toHaveBeenCalledWith("config.json");
      expect(mockReply.type).toHaveBeenCalledWith("application/json");
      expect(mockReply.send).toHaveBeenCalledWith(jsonContent);
    });

    it("should serve non-JSON files as-is", async () => {
      const textContent = "Plain text content";
      mockDocumentService.getFileContent.mockResolvedValue(Buffer.from(textContent));
      mockRequest.params = { fileName: "readme.txt" };

      await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockDocumentService.getFileContent).toHaveBeenCalledWith("readme.txt");
      expect(mockReply.type).not.toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith(Buffer.from(textContent));
    });

    it("should handle invalid JSON gracefully", async () => {
      const invalidJson = "{ invalid json }";
      mockDocumentService.getFileContent.mockResolvedValue(invalidJson);
      mockRequest.params = { fileName: "invalid.json" };

      await handler(mockRequest as FastifyRequest, mockReply);

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to parse JSON"));
      expect(mockReply.type).toHaveBeenCalledWith("application/json");
      expect(mockReply.send).toHaveBeenCalledWith(invalidJson);
    });

    it("should skip documents subdirectory", async () => {
      mockRequest.params = { fileName: "documents" };

      const result = await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockReply.callNotFound).toHaveBeenCalled();
      expect(result).toBe(mockReply);
      expect(mockDocumentService.getFileContent).not.toHaveBeenCalled();
    });

    it("should skip .well-known path", async () => {
      mockRequest.params = { fileName: ".well-known" };

      const result = await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockReply.callNotFound).toHaveBeenCalled();
      expect(result).toBe(mockReply);
    });

    it("should handle file read errors", async () => {
      const error = new NotFoundError("File not found");
      mockDocumentService.getFileContent.mockRejectedValue(error);
      mockRequest.params = { fileName: "missing.txt" };

      await expect(handler(mockRequest as FastifyRequest, mockReply)).rejects.toThrow(error);
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe("ordId endpoint", () => {
    let handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

    beforeEach(() => {
      documentRouter.register(mockFastify as unknown as FastifyInstanceType);
      const routeCall = mockFastify.get.mock.calls.find((call) => call[0] === "/ord/v1/:ordId/*");
      handler = routeCall?.[1] as unknown as (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    });

    it("should resolve file using FQN map", async () => {
      const yamlContent = "openapi: 3.0.0";
      mockDocumentService.getFileContent.mockResolvedValue(Buffer.from(yamlContent));
      mockRequest.params = {
        "ordId": "sap.test:apiResource:TestAPI:v1",
        "*": "api-v1.yaml",
      };

      await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockDocumentService.getFileContent).toHaveBeenCalledWith("apis/test-api/v1/api.yaml");
      expect(mockReply.send).toHaveBeenCalledWith(Buffer.from(yamlContent));
    });

    it("should handle ordId in path instead of params", async () => {
      mockDocumentService.getFileContent.mockResolvedValue(Buffer.from("content"));
      mockRequest.params = {
        "ordId": "some",
        "*": "path/sap.test:apiResource:TestAPI:v1/api-v1.yaml",
      };

      await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockDocumentService.getFileContent).toHaveBeenCalledWith("apis/test-api/v1/api.yaml");
    });

    it("should handle file not in FQN map with valid ordId", async () => {
      mockDocumentService.getFileContent.mockResolvedValue(Buffer.from("content"));
      mockRequest.params = {
        "ordId": "sap.test:apiResource:Unknown:v1",
        "*": "some/file.yaml",
      };

      await handler(mockRequest as FastifyRequest, mockReply);

      // Should construct path from ordId segments (colons replaced with underscores)
      expect(mockDocumentService.getFileContent).toHaveBeenCalledWith("sap.test_apiResource_Unknown_v1/some/file.yaml");
    });

    it("should handle non-ordId paths", async () => {
      mockDocumentService.getFileContent.mockResolvedValue(Buffer.from("content"));
      mockRequest.params = {
        "ordId": "regular",
        "*": "path/to/file.txt",
      };

      await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockDocumentService.getFileContent).toHaveBeenCalledWith("regular/path/to/file.txt");
    });

    it("should handle JSON files in ordId paths", async () => {
      const jsonData = { api: "definition" };
      mockDocumentService.getFileContent.mockResolvedValue(JSON.stringify(jsonData));
      mockRequest.params = {
        "ordId": "sap.test:package:TestPackage:v1",
        "*": "package.json",
      };

      await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockDocumentService.getFileContent).toHaveBeenCalledWith("packages/test/package.json");
      expect(mockReply.type).toHaveBeenCalledWith("application/json");
      expect(mockReply.send).toHaveBeenCalledWith(jsonData);
    });

    it("should handle leading slash in fileName", async () => {
      mockDocumentService.getFileContent.mockResolvedValue(Buffer.from("content"));
      mockRequest.params = {
        "ordId": "sap.test:apiResource:TestAPI:v1",
        "*": "/api-v1.yaml",
      };

      await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockDocumentService.getFileContent).toHaveBeenCalledWith("apis/test-api/v1/api.yaml");
    });

    it("should skip documents subdirectory", async () => {
      mockRequest.params = {
        "ordId": "documents",
        "*": "test.json",
      };

      const result = await handler(mockRequest as FastifyRequest, mockReply);

      expect(mockReply.callNotFound).toHaveBeenCalled();
      expect(result).toBe(mockReply);
    });

    it("should handle errors in ordId resolution", async () => {
      const error = new Error("File read error");
      mockDocumentService.getFileContent.mockRejectedValue(error);
      mockRequest.params = {
        "ordId": "sap.test:apiResource:TestAPI:v1",
        "*": "api-v1.yaml",
      };

      await expect(handler(mockRequest as FastifyRequest, mockReply)).rejects.toThrow(InternalServerError);
      expect(log.error).toHaveBeenCalled();
    });

    it("should handle malformed JSON in ordId path", async () => {
      const malformedJson = "{ malformed: json }";
      mockDocumentService.getFileContent.mockResolvedValue(malformedJson);
      mockRequest.params = {
        "ordId": "test",
        "*": "config.json",
      };

      await handler(mockRequest as FastifyRequest, mockReply);

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to parse JSON"));
      expect(mockReply.type).toHaveBeenCalledWith("application/json");
      expect(mockReply.send).toHaveBeenCalledWith(malformedJson);
    });
  });
});
