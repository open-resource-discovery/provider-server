import { fetchMtlsTrustedCertsFromEndpoints, mergeTrustedCerts, MtlsTrustedCerts } from "../mtlsEndpointService.js";

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("mtlsEndpointService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("fetchMtlsTrustedCertsFromEndpoints", () => {
    it("should fetch cert info from single endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => ({
          certIssuer: "CN=Test CA,O=Test,C=DE",
          certSubject: "CN=test-service,O=Test,C=DE",
        }),
      });

      const result = await fetchMtlsTrustedCertsFromEndpoints(["https://config.example.com/cert-info"]);

      expect(result.trustedIssuers).toEqual(["CN=Test CA,O=Test,C=DE"]);
      expect(result.trustedSubjects).toEqual(["CN=test-service,O=Test,C=DE"]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should fetch cert info from multiple endpoints", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            certIssuer: "CN=CA1,O=Org1,C=DE",
            certSubject: "CN=service1,O=Org1,C=DE",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            certIssuer: "CN=CA2,O=Org2,C=US",
            certSubject: "CN=service2,O=Org2,C=US",
          }),
        });

      const result = await fetchMtlsTrustedCertsFromEndpoints([
        "https://endpoint1.com/cert",
        "https://endpoint2.com/cert",
      ]);

      expect(result.trustedIssuers).toHaveLength(2);
      expect(result.trustedIssuers).toContain("CN=CA1,O=Org1,C=DE");
      expect(result.trustedIssuers).toContain("CN=CA2,O=Org2,C=US");
      expect(result.trustedSubjects).toHaveLength(2);
      expect(result.trustedSubjects).toContain("CN=service1,O=Org1,C=DE");
      expect(result.trustedSubjects).toContain("CN=service2,O=Org2,C=US");
    });

    it("should deduplicate identical cert info from multiple endpoints", async () => {
      const sameCertInfo = {
        certIssuer: "CN=Shared CA,O=Test,C=DE",
        certSubject: "CN=shared-service,O=Test,C=DE",
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => sameCertInfo,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => sameCertInfo,
        });

      const result = await fetchMtlsTrustedCertsFromEndpoints([
        "https://endpoint1.com/cert",
        "https://endpoint2.com/cert",
      ]);

      expect(result.trustedIssuers).toEqual(["CN=Shared CA,O=Test,C=DE"]);
      expect(result.trustedSubjects).toEqual(["CN=shared-service,O=Test,C=DE"]);
    });

    it("should handle failed endpoint gracefully", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            certIssuer: "CN=CA1,O=Org1,C=DE",
            certSubject: "CN=service1,O=Org1,C=DE",
          }),
        })
        .mockRejectedValueOnce(new Error("Network error"));

      const result = await fetchMtlsTrustedCertsFromEndpoints([
        "https://good-endpoint.com/cert",
        "https://bad-endpoint.com/cert",
      ]);

      expect(result.trustedIssuers).toEqual(["CN=CA1,O=Org1,C=DE"]);
      expect(result.trustedSubjects).toEqual(["CN=service1,O=Org1,C=DE"]);
    });

    it("should handle HTTP error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await fetchMtlsTrustedCertsFromEndpoints(["https://error-endpoint.com/cert"]);

      expect(result.trustedIssuers).toEqual([]);
      expect(result.trustedSubjects).toEqual([]);
    });

    it("should handle invalid response format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => ({
          // Missing certIssuer and certSubject
          invalid: "response",
        }),
      });

      const result = await fetchMtlsTrustedCertsFromEndpoints(["https://invalid-endpoint.com/cert"]);

      expect(result.trustedIssuers).toEqual([]);
      expect(result.trustedSubjects).toEqual([]);
    });

    it("should return empty arrays for empty endpoints list", async () => {
      const result = await fetchMtlsTrustedCertsFromEndpoints([]);

      expect(result.trustedIssuers).toEqual([]);
      expect(result.trustedSubjects).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should use custom timeout", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => ({
          certIssuer: "CN=Test CA,O=Test,C=DE",
          certSubject: "CN=test-service,O=Test,C=DE",
        }),
      });

      await fetchMtlsTrustedCertsFromEndpoints(["https://config.example.com/cert-info"], 5000);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://config.example.com/cert-info",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });

  describe("mergeTrustedCerts", () => {
    it("should merge certs from endpoints and config", () => {
      const fromEndpoints: MtlsTrustedCerts = {
        trustedIssuers: ["CN=Endpoint CA,O=Test,C=DE"],
        trustedSubjects: ["CN=endpoint-service,O=Test,C=DE"],
      };

      const fromConfig: MtlsTrustedCerts = {
        trustedIssuers: ["CN=Config CA,O=Test,C=US"],
        trustedSubjects: ["CN=config-service,O=Test,C=US"],
      };

      const result = mergeTrustedCerts(fromEndpoints, fromConfig);

      expect(result.trustedIssuers).toHaveLength(2);
      expect(result.trustedIssuers).toContain("CN=Endpoint CA,O=Test,C=DE");
      expect(result.trustedIssuers).toContain("CN=Config CA,O=Test,C=US");
      expect(result.trustedSubjects).toHaveLength(2);
      expect(result.trustedSubjects).toContain("CN=endpoint-service,O=Test,C=DE");
      expect(result.trustedSubjects).toContain("CN=config-service,O=Test,C=US");
    });

    it("should deduplicate identical values", () => {
      const fromEndpoints: MtlsTrustedCerts = {
        trustedIssuers: ["CN=Shared CA,O=Test,C=DE"],
        trustedSubjects: ["CN=shared-service,O=Test,C=DE"],
      };

      const fromConfig: MtlsTrustedCerts = {
        trustedIssuers: ["CN=Shared CA,O=Test,C=DE"],
        trustedSubjects: ["CN=shared-service,O=Test,C=DE"],
      };

      const result = mergeTrustedCerts(fromEndpoints, fromConfig);

      expect(result.trustedIssuers).toEqual(["CN=Shared CA,O=Test,C=DE"]);
      expect(result.trustedSubjects).toEqual(["CN=shared-service,O=Test,C=DE"]);
    });

    it("should handle empty endpoints", () => {
      const fromEndpoints: MtlsTrustedCerts = {
        trustedIssuers: [],
        trustedSubjects: [],
      };

      const fromConfig: MtlsTrustedCerts = {
        trustedIssuers: ["CN=Config CA,O=Test,C=DE"],
        trustedSubjects: ["CN=config-service,O=Test,C=DE"],
      };

      const result = mergeTrustedCerts(fromEndpoints, fromConfig);

      expect(result.trustedIssuers).toEqual(["CN=Config CA,O=Test,C=DE"]);
      expect(result.trustedSubjects).toEqual(["CN=config-service,O=Test,C=DE"]);
    });

    it("should handle empty config", () => {
      const fromEndpoints: MtlsTrustedCerts = {
        trustedIssuers: ["CN=Endpoint CA,O=Test,C=DE"],
        trustedSubjects: ["CN=endpoint-service,O=Test,C=DE"],
      };

      const fromConfig: MtlsTrustedCerts = {
        trustedIssuers: [],
        trustedSubjects: [],
      };

      const result = mergeTrustedCerts(fromEndpoints, fromConfig);

      expect(result.trustedIssuers).toEqual(["CN=Endpoint CA,O=Test,C=DE"]);
      expect(result.trustedSubjects).toEqual(["CN=endpoint-service,O=Test,C=DE"]);
    });

    it("should handle both empty", () => {
      const fromEndpoints: MtlsTrustedCerts = {
        trustedIssuers: [],
        trustedSubjects: [],
      };

      const fromConfig: MtlsTrustedCerts = {
        trustedIssuers: [],
        trustedSubjects: [],
      };

      const result = mergeTrustedCerts(fromEndpoints, fromConfig);

      expect(result.trustedIssuers).toEqual([]);
      expect(result.trustedSubjects).toEqual([]);
    });
  });
});
