import { fixResourceDefinitionUrl, processPackageLinks, processResourceDefinitions } from "../documentProcessing.js";
import { OptAuthMethod } from "../../model/cli.js";

jest.mock("../ordConfig.js", () => ({
  getOrdDocumentAccessStrategies: (): { type: string }[] => [{ type: "open" }],
}));

const BASE_URL = "https://example.com";
const ORD_ID = "sap.test:apiResource:myApi:v1";

describe("fixResourceDefinitionUrl", () => {
  describe("root-relative mode (absoluteUrls = false)", () => {
    it("returns root-relative path for a relative URL", () => {
      expect(fixResourceDefinitionUrl("./openapi.json", ORD_ID)).toBe("/ord/v1/openapi.json");
    });

    it("returns root-relative path with ORD ID segment restored", () => {
      const escaped = "sap.test_apiResource_myApi_v1";
      const url = `./${escaped}/openapi.json`;
      expect(fixResourceDefinitionUrl(url, ORD_ID)).toBe(`/ord/v1/${ORD_ID}/openapi.json`);
    });

    it("leaves remote URLs untouched", () => {
      const remote = "https://cdn.example.com/openapi.json";
      expect(fixResourceDefinitionUrl(remote, ORD_ID)).toBe(remote);
    });
  });

  describe("absolute URL mode (absoluteUrls = true)", () => {
    it("prepends baseUrl to root-relative path", () => {
      expect(fixResourceDefinitionUrl("./openapi.json", ORD_ID, BASE_URL, true)).toBe(
        `${BASE_URL}/ord/v1/openapi.json`,
      );
    });

    it("prepends baseUrl and restores ORD ID segment", () => {
      const escaped = "sap.test_apiResource_myApi_v1";
      const url = `./${escaped}/openapi.json`;
      expect(fixResourceDefinitionUrl(url, ORD_ID, BASE_URL, true)).toBe(`${BASE_URL}/ord/v1/${ORD_ID}/openapi.json`);
    });

    it("leaves remote URLs untouched even in absolute mode", () => {
      const remote = "https://cdn.example.com/openapi.json";
      expect(fixResourceDefinitionUrl(remote, ORD_ID, BASE_URL, true)).toBe(remote);
    });
  });
});

describe("processPackageLinks", () => {
  const pkg = {
    ordId: "sap.test:package:myPkg:v1",
    title: "My Package",
    shortDescription: "short",
    description: "desc",
    version: "1.0.0",
    partOfProducts: [],
    vendor: "sap:vendor:SAP:",
    packageLinks: [{ type: "license" as const, url: "licenses/license.txt" }],
    files: [
      {
        fileFormat: "application/pdf" as const,
        url: "docs/readme.pdf",
        title: "Readme",
        mediaType: "application/pdf" as const,
      },
    ],
  };

  it("converts relative packageLinks to root-relative by default", () => {
    const result = processPackageLinks([pkg]);
    expect(result[0].packageLinks![0].url).toBe("/ord/v1/licenses/license.txt");
    expect(result[0].files![0].url).toBe("/ord/v1/docs/readme.pdf");
  });

  it("prepends baseUrl when absoluteUrls is true", () => {
    const result = processPackageLinks([pkg], BASE_URL, true);
    expect(result[0].packageLinks![0].url).toBe(`${BASE_URL}/ord/v1/licenses/license.txt`);
    expect(result[0].files![0].url).toBe(`${BASE_URL}/ord/v1/docs/readme.pdf`);
  });

  it("leaves already-absolute URLs untouched", () => {
    const pkgWithAbsolute = {
      ...pkg,
      packageLinks: [{ type: "license" as const, url: "https://example.com/license.txt" }],
    };
    const result = processPackageLinks([pkgWithAbsolute], BASE_URL, true);
    expect(result[0].packageLinks![0].url).toBe("https://example.com/license.txt");
  });
});

describe("processResourceDefinitions", () => {
  const resource = {
    ordId: ORD_ID,
    title: "My API",
    shortDescription: "short",
    description: "desc",
    version: "1.0.0",
    releaseStatus: "active" as const,
    visibility: "public" as const,
    resourceDefinitions: [
      { type: "openapi-v3" as const, mediaType: "application/json" as const, url: "./openapi.json" },
    ],
    partOfPackage: "sap.test:package:myPkg:v1",
    apiProtocol: "rest" as const,
  };

  it("produces root-relative resource definition URLs by default", () => {
    const result = processResourceDefinitions([resource], [OptAuthMethod.Open]);
    expect(result[0].resourceDefinitions[0].url).toBe("/ord/v1/openapi.json");
  });

  it("produces absolute resource definition URLs when absoluteUrls is true", () => {
    const result = processResourceDefinitions([resource], [OptAuthMethod.Open], BASE_URL, true);
    expect(result[0].resourceDefinitions[0].url).toBe(`${BASE_URL}/ord/v1/openapi.json`);
  });
});
