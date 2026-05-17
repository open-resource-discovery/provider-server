import { OrdDocument } from "@open-resource-discovery/specification";
import { OptAuthMethod } from "../../model/cli.js";
import { ProcessingContext } from "../../services/interfaces/processingContext.js";
import { processOrdDocument } from "../documentProcessing.js";
import { getOrdDocumentAccessStrategies } from "../ordConfig.js";
import { getDocumentPerspective } from "../../model/perspective.js";

jest.mock("../ordConfig.js");
jest.mock("../../model/perspective.js");

const mockDoc = {
  openResourceDiscovery: "1.9",
} as unknown as OrdDocument;

const context: ProcessingContext = {
  baseUrl: "https://example.com",
  authMethods: [OptAuthMethod.Open],
  cfMtlsAccessStrategies: [],
};

describe("processOrdDocument", () => {
  beforeEach(() => {
    (getOrdDocumentAccessStrategies as jest.Mock).mockReturnValue([{ type: "open" }]);
    (getDocumentPerspective as jest.Mock).mockReturnValue("system-instance");
  });

  it("injects baseUrl into describedSystemInstance", () => {
    const result = processOrdDocument(mockDoc, context, null);

    expect(result.describedSystemInstance?.baseUrl).toBe("https://example.com");
  });

  it("preserves existing describedSystemVersion", () => {
    const doc = { ...mockDoc, describedSystemVersion: { version: "2.0.0" } } as unknown as OrdDocument;

    const result = processOrdDocument(doc, context, "abcdef1234567890");

    expect(result.describedSystemVersion).toEqual({ version: "2.0.0" });
  });

  it("defaults describedSystemVersion from directory hash for system-version perspective", () => {
    (getDocumentPerspective as jest.Mock).mockReturnValue("system-version");

    const result = processOrdDocument(mockDoc, context, "abcdef1234567890");

    expect(result.describedSystemVersion).toEqual({ version: "1.0.0-abcdef12" });
  });

  it("passes cfMtlsAccessStrategies to getOrdDocumentAccessStrategies", () => {
    const strategies = ["sap.businesshub:mtls:v1"];
    const doc = {
      ...mockDoc,
      apiResources: [{ ordId: "sap.test:apiResource:API:v1", resourceDefinitions: [] }],
    } as unknown as OrdDocument;

    processOrdDocument(doc, { ...context, cfMtlsAccessStrategies: strategies }, null);

    expect(getOrdDocumentAccessStrategies).toHaveBeenCalledWith(context.authMethods, strategies);
  });
});
