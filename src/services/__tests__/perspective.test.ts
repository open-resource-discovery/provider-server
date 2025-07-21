import { ORDDocument } from "@open-resource-discovery/specification";
import { DocumentService } from "../documentService.js";
import { CacheService } from "../cacheService.js";
import { DocumentRepository } from "../../repositories/interfaces/documentRepository.js";
import { ProcessingContext } from "../interfaces/processingContext.js";
import { OptAuthMethod } from "../../model/cli.js";
import { Perspective } from "../../model/perspective.js";

const mockRepository: jest.Mocked<DocumentRepository> = {
  getDocument: jest.fn(),
  getDocuments: jest.fn(),
  getDirectoryHash: jest.fn(),
  listFiles: jest.fn(),
  getFileContent: jest.fn(),
};

let cacheService: CacheService;
let documentService: DocumentService;

const mockContext: ProcessingContext = {
  baseUrl: "http://127.0.0.1:8080",
  authMethods: [OptAuthMethod.Open],
};

const createMockDocument = (perspective?: Perspective): ORDDocument => ({
  openResourceDiscovery: "1.12",
  describedSystemInstance: {
    baseUrl: "http://example.com",
  },
  perspective,
});

describe("Perspective Support", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService = new CacheService();
    documentService = new DocumentService(mockRepository, cacheService, mockContext, "documents");
  });

  describe("getDocumentPerspective", () => {
    it("should default to 'system-instance' when no perspective is specified", async () => {
      const doc1 = createMockDocument();
      const doc2 = createMockDocument(undefined);

      const documentsMap = new Map([
        ["documents/doc1.json", doc1],
        ["documents/doc2.json", doc2],
      ]);

      mockRepository.getDirectoryHash.mockResolvedValue("test-hash");
      mockRepository.getDocuments.mockResolvedValue(documentsMap);

      const config = await documentService.getOrdConfiguration();

      expect(config.openResourceDiscoveryV1.documents).toHaveLength(2);
      config.openResourceDiscoveryV1.documents?.forEach((doc) => {
        expect(doc).toHaveProperty("perspective", "system-instance");
      });
    });

    it("should preserve explicitly set perspective values", async () => {
      const doc1 = createMockDocument("system-instance");
      const doc2 = createMockDocument("system-version");
      const doc3 = createMockDocument("system-independent");

      const documentsMap = new Map([
        ["documents/doc1.json", doc1],
        ["documents/doc2.json", doc2],
        ["documents/doc3.json", doc3],
      ]);

      mockRepository.getDirectoryHash.mockResolvedValue("test-hash");
      mockRepository.getDocuments.mockResolvedValue(documentsMap);

      const config = await documentService.getOrdConfiguration();

      expect(config.openResourceDiscoveryV1.documents).toHaveLength(3);
      const docs = config.openResourceDiscoveryV1.documents || [];

      expect(docs.find((d) => d.url.includes("doc1"))).toHaveProperty("perspective", "system-instance");
      expect(docs.find((d) => d.url.includes("doc2"))).toHaveProperty("perspective", "system-version");
      expect(docs.find((d) => d.url.includes("doc3"))).toHaveProperty("perspective", "system-independent");
    });
  });

  describe("perspective filtering", () => {
    beforeEach(async () => {
      const doc1 = createMockDocument("system-instance");
      const doc2 = createMockDocument("system-version");
      const doc3 = createMockDocument("system-version");
      const doc4 = createMockDocument("system-independent");
      const doc5 = createMockDocument();

      const documentsMap = new Map([
        ["documents/doc1.json", doc1],
        ["documents/doc2.json", doc2],
        ["documents/doc3.json", doc3],
        ["documents/doc4.json", doc4],
        ["documents/doc5.json", doc5],
      ]);

      mockRepository.getDirectoryHash.mockResolvedValue("test-hash");
      mockRepository.getDocuments.mockResolvedValue(documentsMap);

      await documentService.getOrdConfiguration();
    });

    it("should return all documents when no perspective filter is provided", async () => {
      const config = await documentService.getOrdConfiguration();
      expect(config.openResourceDiscoveryV1.documents).toHaveLength(5);
    });

    it("should filter documents by system-version perspective", async () => {
      const config = await documentService.getOrdConfiguration("system-version");
      expect(config.openResourceDiscoveryV1.documents).toHaveLength(2);

      config.openResourceDiscoveryV1.documents?.forEach((doc) => {
        expect(doc).toHaveProperty("perspective", "system-version");
      });
    });

    it("should filter documents by system-instance perspective", async () => {
      const config = await documentService.getOrdConfiguration("system-instance");
      expect(config.openResourceDiscoveryV1.documents).toHaveLength(2);

      config.openResourceDiscoveryV1.documents?.forEach((doc) => {
        expect(doc).toHaveProperty("perspective", "system-instance");
      });
    });

    it("should filter documents by system-independent perspective", async () => {
      const config = await documentService.getOrdConfiguration("system-independent");
      expect(config.openResourceDiscoveryV1.documents).toHaveLength(1);

      config.openResourceDiscoveryV1.documents?.forEach((doc) => {
        expect(doc).toHaveProperty("perspective", "system-independent");
      });
    });

    it("should return empty documents array when no documents match the perspective", async () => {
      cacheService.clearCache();

      const doc1 = createMockDocument("system-instance");
      const doc2 = createMockDocument("system-instance");

      const documentsMap = new Map([
        ["documents/doc1.json", doc1],
        ["documents/doc2.json", doc2],
      ]);

      mockRepository.getDocuments.mockResolvedValue(documentsMap);

      const config = await documentService.getOrdConfiguration("system-version");
      expect(config.openResourceDiscoveryV1.documents).toHaveLength(0);
    });
  });

  describe("caching behavior with perspectives", () => {
    it("should use cached configuration and filter dynamically", async () => {
      const doc1 = createMockDocument("system-instance");
      const doc2 = createMockDocument("system-version");

      const documentsMap = new Map([
        ["documents/doc1.json", doc1],
        ["documents/doc2.json", doc2],
      ]);

      mockRepository.getDirectoryHash.mockResolvedValue("test-hash");
      mockRepository.getDocuments.mockResolvedValue(documentsMap);

      await documentService.getOrdConfiguration();
      expect(mockRepository.getDocuments).toHaveBeenCalledTimes(1);

      const config1 = await documentService.getOrdConfiguration("system-instance");
      const config2 = await documentService.getOrdConfiguration("system-version");
      const config3 = await documentService.getOrdConfiguration();

      // getDocuments should only be called once (during initial load)
      expect(mockRepository.getDocuments).toHaveBeenCalledTimes(1);

      expect(config1.openResourceDiscoveryV1.documents).toHaveLength(1);
      expect(config2.openResourceDiscoveryV1.documents).toHaveLength(1);
      expect(config3.openResourceDiscoveryV1.documents).toHaveLength(2);
    });
  });
});
