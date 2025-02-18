import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { APIResource, APIResourceDefinition, ORDConfiguration, ORDDocument } from "@sap/open-resource-discovery";
import { GitHubFileResponse } from "src/model/github.js";
import { OptAuthMethod } from "src/model/cli.js";
import { ProcessingContext, OrdDocumentProcessor } from "src/services/ordProcessorService.js";
import path from "path";
import { ORD_SERVER_PREFIX_PATH } from "../../constant.js";

describe("ORD Documents", () => {
  beforeAll(() => {
    const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = mockFetch;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockContext: ProcessingContext = {
    baseUrl: "http://127.0.0.1:8080",
    authMethods: [OptAuthMethod.Open],
    githubBranch: "main",
    githubApiUrl: "https://api.github.com",
    githubRepo: "owner/repo",
    githubToken: "token",
  };

  const mockApiResource: APIResource = {
    ordId: "test:api",
    title: "test",
    shortDescription: "test short desc",
    description: "test description",
    partOfPackage: "test",
    version: "1.0.0",
    visibility: "public",
    releaseStatus: "active",
    apiProtocol: "rest",
    resourceDefinitions: [
      {
        type: "openapi-v3",
        url: "test.json",
        mediaType: "application/json",
      },
    ],
  };

  const mockFileContent: GitHubFileResponse = {
    content: btoa(
      JSON.stringify({
        ordId: "test:api",
        filePath: "/testpath",
        url: "https://github.com/testurl.json",
      }),
    ),
    encoding: "base64",
    name: "file-github",
    sha: "sha-test",
  };

  const mockDocument: ORDDocument = {
    openResourceDiscovery: "1.6",
    apiResources: [
      {
        ...mockApiResource,
      },
    ],
  };

  const mockResponse: Partial<Response> = {
    ok: true,
    json: jest.fn().mockResolvedValue(mockFileContent as never) as () => Promise<GitHubFileResponse>,
  };

  describe("Github documents", () => {
    it("should cache processed ORD document", () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue(mockResponse as Response);

      const firstResult = OrdDocumentProcessor.processGithubDocument(mockContext, "sha1", mockDocument);
      const secondResult = OrdDocumentProcessor.processGithubDocument(mockContext, "sha1", mockDocument);

      expect(firstResult).toEqual(secondResult);
      expect(firstResult.apiResources?.[0].resourceDefinitions?.[0].url).toBe(`${ORD_SERVER_PREFIX_PATH}/test.json`);
    });

    it("should invalidate cache when SHA changes", () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValue(mockResponse as Response);

      const firstResult = OrdDocumentProcessor.processGithubDocument(mockContext, "sha1", mockDocument);
      const secondResult = OrdDocumentProcessor.processGithubDocument(mockContext, "sha2", {
        ...mockDocument,
        apiResources: [
          {
            ...mockDocument.apiResources![0],
            title: "Updated Test API",
          },
        ],
      });

      expect(firstResult).not.toEqual(secondResult);
      expect(secondResult.apiResources?.[0].title).toBe("Updated Test API");
    });
  });

  describe("Local documents", () => {
    const mockOrdConfig: ORDConfiguration = {
      openResourceDiscoveryV1: {
        documents: [],
      },
    };

    it("should process valid ORD documents", () => {
      const processedDocuments = OrdDocumentProcessor.processLocalDocuments(
        {
          baseUrl: "http://127.0.0.1:8080",
          authMethods: [OptAuthMethod.Open],
        },
        mockOrdConfig,
        path.posix.join(process.cwd(), "src/__tests__/test-files/"),
      );

      expect(Object.keys(processedDocuments).length).toBeGreaterThan(0);
    });

    // Clean up after tests
    afterEach(() => {
      jest.clearAllMocks();
    });
  });

  describe("URL rewrite", () => {
    it("should not modify remote URL in resource definitions", () => {
      const testDocument = { ...mockDocument };

      const apiResource = { ...mockApiResource };
      const rd: APIResourceDefinition = {
        url: "https://example.com/someresource.json",
        type: "openapi-v3",
        mediaType: "application/json",
      };
      apiResource.resourceDefinitions = [rd];
      testDocument.apiResources = [apiResource];

      const result = OrdDocumentProcessor.processGithubDocument(mockContext, "remote-sha", testDocument);
      expect(result.apiResources?.[0].resourceDefinitions?.[0].url).toEqual(rd.url);
    });

    it("should modify local URL in resource definitions", () => {
      const testDocument = { ...mockDocument };

      const apiResource = { ...mockApiResource };
      const defaultUrl = `/sap.xref_apiResource_astronomy_v1/openapi-v3.json`;
      const rd: APIResourceDefinition = {
        url: `..${defaultUrl}`,
        type: "openapi-v3",
        mediaType: "application/json",
      };
      apiResource.resourceDefinitions = [rd];
      testDocument.apiResources = [apiResource];

      const rewrittenUrl = `${ORD_SERVER_PREFIX_PATH}${defaultUrl}`;
      const result = OrdDocumentProcessor.processGithubDocument(mockContext, "local-sha", testDocument);
      expect(result.apiResources?.[0].resourceDefinitions?.[0].url).toEqual(rewrittenUrl);
    });
  });
});
