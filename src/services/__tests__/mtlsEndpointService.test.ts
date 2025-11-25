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

      expect(result.trustedCerts).toEqual([
        { issuer: "CN=Test CA,O=Test,C=DE", subject: "CN=test-service,O=Test,C=DE" },
      ]);
      expect(result.trustedRootCaDns).toEqual([]);
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

      expect(result.trustedCerts).toHaveLength(2);
      expect(result.trustedCerts).toContainEqual({ issuer: "CN=CA1,O=Org1,C=DE", subject: "CN=service1,O=Org1,C=DE" });
      expect(result.trustedCerts).toContainEqual({ issuer: "CN=CA2,O=Org2,C=US", subject: "CN=service2,O=Org2,C=US" });
      expect(result.trustedRootCaDns).toEqual([]);
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

      expect(result.trustedCerts).toEqual([
        { issuer: "CN=Shared CA,O=Test,C=DE", subject: "CN=shared-service,O=Test,C=DE" },
      ]);
      expect(result.trustedRootCaDns).toEqual([]);
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

      expect(result.trustedCerts).toEqual([{ issuer: "CN=CA1,O=Org1,C=DE", subject: "CN=service1,O=Org1,C=DE" }]);
      expect(result.trustedRootCaDns).toEqual([]);
    });

    it("should handle HTTP error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await fetchMtlsTrustedCertsFromEndpoints(["https://error-endpoint.com/cert"]);

      expect(result.trustedCerts).toEqual([]);
      expect(result.trustedRootCaDns).toEqual([]);
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

      expect(result.trustedCerts).toEqual([]);
      expect(result.trustedRootCaDns).toEqual([]);
    });

    it("should return empty arrays for empty endpoints list", async () => {
      const result = await fetchMtlsTrustedCertsFromEndpoints([]);

      expect(result.trustedCerts).toEqual([]);
      expect(result.trustedRootCaDns).toEqual([]);
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
    it("should merge cert pairs from endpoints and config", () => {
      const fromEndpoints: MtlsTrustedCerts = {
        trustedCerts: [{ issuer: "CN=Endpoint CA,O=Test,C=DE", subject: "CN=endpoint-service,O=Test,C=DE" }],
        trustedRootCaDns: [],
      };

      const fromConfig: MtlsTrustedCerts = {
        trustedCerts: [{ issuer: "CN=Config CA,O=Test,C=US", subject: "CN=config-service,O=Test,C=US" }],
        trustedRootCaDns: ["CN=Config Root CA,O=Test,C=US"],
      };

      const result = mergeTrustedCerts(fromEndpoints, fromConfig);

      expect(result.trustedCerts).toHaveLength(2);
      expect(result.trustedCerts).toContainEqual({
        issuer: "CN=Endpoint CA,O=Test,C=DE",
        subject: "CN=endpoint-service,O=Test,C=DE",
      });
      expect(result.trustedCerts).toContainEqual({
        issuer: "CN=Config CA,O=Test,C=US",
        subject: "CN=config-service,O=Test,C=US",
      });
      expect(result.trustedRootCaDns).toHaveLength(1); // Only from config
      expect(result.trustedRootCaDns).toContain("CN=Config Root CA,O=Test,C=US");
    });

    it("should deduplicate identical cert pairs", () => {
      const fromEndpoints: MtlsTrustedCerts = {
        trustedCerts: [{ issuer: "CN=Shared CA,O=Test,C=DE", subject: "CN=shared-service,O=Test,C=DE" }],
        trustedRootCaDns: [],
      };

      const fromConfig: MtlsTrustedCerts = {
        trustedCerts: [{ issuer: "CN=Shared CA,O=Test,C=DE", subject: "CN=shared-service,O=Test,C=DE" }],
        trustedRootCaDns: ["CN=Shared Root CA,O=Test,C=DE"],
      };

      const result = mergeTrustedCerts(fromEndpoints, fromConfig);

      expect(result.trustedCerts).toEqual([
        { issuer: "CN=Shared CA,O=Test,C=DE", subject: "CN=shared-service,O=Test,C=DE" },
      ]);
      expect(result.trustedRootCaDns).toEqual(["CN=Shared Root CA,O=Test,C=DE"]); // Only from config
    });

    it("should handle empty endpoints", () => {
      const fromEndpoints: MtlsTrustedCerts = {
        trustedCerts: [],
        trustedRootCaDns: [],
      };

      const fromConfig: MtlsTrustedCerts = {
        trustedCerts: [{ issuer: "CN=Config CA,O=Test,C=DE", subject: "CN=config-service,O=Test,C=DE" }],
        trustedRootCaDns: ["CN=Config Root CA,O=Test,C=DE"],
      };

      const result = mergeTrustedCerts(fromEndpoints, fromConfig);

      expect(result.trustedCerts).toEqual([
        { issuer: "CN=Config CA,O=Test,C=DE", subject: "CN=config-service,O=Test,C=DE" },
      ]);
      expect(result.trustedRootCaDns).toEqual(["CN=Config Root CA,O=Test,C=DE"]);
    });

    it("should handle empty config", () => {
      const fromEndpoints: MtlsTrustedCerts = {
        trustedCerts: [{ issuer: "CN=Endpoint CA,O=Test,C=DE", subject: "CN=endpoint-service,O=Test,C=DE" }],
        trustedRootCaDns: [],
      };

      const fromConfig: MtlsTrustedCerts = {
        trustedCerts: [],
        trustedRootCaDns: [],
      };

      const result = mergeTrustedCerts(fromEndpoints, fromConfig);

      expect(result.trustedCerts).toEqual([
        { issuer: "CN=Endpoint CA,O=Test,C=DE", subject: "CN=endpoint-service,O=Test,C=DE" },
      ]);
      expect(result.trustedRootCaDns).toEqual([]); // No root CAs from either source
    });

    it("should handle both empty", () => {
      const fromEndpoints: MtlsTrustedCerts = {
        trustedCerts: [],
        trustedRootCaDns: [],
      };

      const fromConfig: MtlsTrustedCerts = {
        trustedCerts: [],
        trustedRootCaDns: [],
      };

      const result = mergeTrustedCerts(fromEndpoints, fromConfig);

      expect(result.trustedCerts).toEqual([]);
      expect(result.trustedRootCaDns).toEqual([]);
    });

    it("should deduplicate root CAs with same DN components in different order", () => {
      const fromEndpoints: MtlsTrustedCerts = {
        trustedCerts: [],
        trustedRootCaDns: ["CN=Root CA,O=Test,C=DE"],
      };

      const fromConfig: MtlsTrustedCerts = {
        trustedCerts: [],
        trustedRootCaDns: ["/C=DE/O=Test/CN=Root CA"],
      };

      const result = mergeTrustedCerts(fromEndpoints, fromConfig);

      // Should deduplicate because DN components match despite different order/format
      expect(result.trustedRootCaDns).toHaveLength(1);
      expect(result.trustedRootCaDns[0]).toBe("CN=Root CA,O=Test,C=DE");
    });

    it("should keep unique root CAs with different DN components", () => {
      const fromEndpoints: MtlsTrustedCerts = {
        trustedCerts: [],
        trustedRootCaDns: ["CN=Root CA 1,O=Org1,C=DE"],
      };

      const fromConfig: MtlsTrustedCerts = {
        trustedCerts: [],
        trustedRootCaDns: ["CN=Root CA 2,O=Org2,C=US"],
      };

      const result = mergeTrustedCerts(fromEndpoints, fromConfig);

      expect(result.trustedRootCaDns).toHaveLength(2);
      expect(result.trustedRootCaDns).toContain("CN=Root CA 1,O=Org1,C=DE");
      expect(result.trustedRootCaDns).toContain("CN=Root CA 2,O=Org2,C=US");
    });
  });
});
