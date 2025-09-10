import { VersionService } from "../versionService.js";
import { log } from "../../util/logger.js";

jest.mock("../../util/logger.js");

global.fetch = jest.fn();

const mockResponse = (data: {
  ok: boolean;
  json?: () => Promise<unknown>;
  status?: number;
  statusText?: string;
}): Response => {
  const response = {
    ...data,
    json: data.json || ((): Promise<unknown> => Promise.resolve({})),
  };
  return response as unknown as Response;
};

describe("VersionService", () => {
  let versionService: VersionService;
  const mockLog = log as jest.Mocked<typeof log>;
  const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Reset singleton instance
    (VersionService as unknown as { instance: null }).instance = null;
    versionService = VersionService.getInstance();
    mockLog.warn = jest.fn();
    mockLog.error = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = VersionService.getInstance();
      const instance2 = VersionService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("getVersionInfo", () => {
    it("should return version info with latest version", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ tags: ["0.1.0", "0.2.0", "0.3.0", "latest"] }),
          }),
        );

      const result = await versionService.getVersionInfo("0.2.0");

      expect(result).toEqual({
        current: "0.2.0",
        latest: "0.3.0",
        isOutdated: true,
        lastChecked: expect.any(Date),
      });
    });

    it("should handle up-to-date version", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ tags: ["0.1.0", "0.2.0", "0.3.0"] }),
          }),
        );

      const result = await versionService.getVersionInfo("0.3.0");

      expect(result).toEqual({
        current: "0.3.0",
        latest: "0.3.0",
        isOutdated: false,
        lastChecked: expect.any(Date),
      });
    });

    it("should handle fetch errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await versionService.getVersionInfo("1.0.0");

      expect(mockLog.warn).toHaveBeenCalledWith("Failed to fetch latest version from GHCR:", expect.any(Error));
      expect(result).toEqual({
        current: "1.0.0",
        latest: "1.0.0",
        isOutdated: false,
        lastChecked: expect.any(Date),
      });
    });

    it("should use cached version within timeout", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ tags: ["0.1.0", "0.2.0"] }),
          }),
        );

      await versionService.getVersionInfo("0.1.0");
      mockFetch.mockClear();

      // Second call within cache timeout
      jest.advanceTimersByTime(30 * 60 * 1000); // 30 minutes
      const result = await versionService.getVersionInfo("0.1.0");

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.latest).toBe("0.2.0");
    });

    it("should refresh cache after timeout", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ tags: ["0.1.0", "0.2.0"] }),
          }),
        );

      await versionService.getVersionInfo("0.1.0");
      mockFetch.mockClear();

      // Advance time past cache timeout
      jest.advanceTimersByTime(61 * 60 * 1000); // 61 minutes

      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ tags: ["0.1.0", "0.2.0", "0.3.0"] }),
          }),
        );

      const result = await versionService.getVersionInfo("0.1.0");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.latest).toBe("0.3.0");
    });
  });

  describe("fetchTags", () => {
    it("should handle auth token fetch failure", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
        }),
      );

      await expect(versionService.getVersionInfo("1.0.0")).resolves.toEqual({
        current: "1.0.0",
        latest: "1.0.0",
        isOutdated: false,
        lastChecked: expect.any(Date),
      });

      expect(mockLog.error).toHaveBeenCalled();
    });

    it("should handle tags fetch failure", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: false,
            status: 404,
            statusText: "Not Found",
          }),
        );

      await expect(versionService.getVersionInfo("1.0.0")).resolves.toEqual({
        current: "1.0.0",
        latest: "1.0.0",
        isOutdated: false,
        lastChecked: expect.any(Date),
      });

      expect(mockLog.error).toHaveBeenCalled();
    });

    it("should handle missing token in response", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: true,
          json: () => Promise.resolve({}),
        }),
      );

      await expect(versionService.getVersionInfo("1.0.0")).resolves.toEqual({
        current: "1.0.0",
        latest: "1.0.0",
        isOutdated: false,
        lastChecked: expect.any(Date),
      });
    });

    it("should handle missing tags in response", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({}),
          }),
        );

      const result = await versionService.getVersionInfo("1.0.0");

      expect(result.latest).toBe("0.0.0");
    });
  });

  describe("findLatestVersion", () => {
    it("should handle version tags with v prefix", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ tags: ["v0.1.0", "v0.2.0", "v0.3.0"] }),
          }),
        );

      const result = await versionService.getVersionInfo("v0.2.0");

      expect(result.latest).toBe("v0.3.0");
    });

    it("should filter out non-version tags", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () =>
              Promise.resolve({
                tags: ["0.1.0", "0.2.0", "dev", "feature-branch", "0.3.0-beta", "0.4.0"],
              }),
          }),
        );

      const result = await versionService.getVersionInfo("0.3.0");

      expect(result.latest).toBe("0.4.0");
    });

    it("should return latest tag when no version tags exist", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ tags: ["latest", "dev", "feature"] }),
          }),
        );

      const result = await versionService.getVersionInfo("1.0.0");

      expect(result.latest).toBe("latest");
    });

    it("should return 0.0.0 when no tags exist", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ tags: [] }),
          }),
        );

      const result = await versionService.getVersionInfo("1.0.0");

      expect(result.latest).toBe("0.0.0");
    });
  });

  describe("compareVersions", () => {
    it("should correctly compare versions", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () =>
              Promise.resolve({
                tags: ["0.10.0", "0.2.0", "0.1.10", "1.0.0", "0.9.9"],
              }),
          }),
        );

      const result = await versionService.getVersionInfo("0.9.0");

      expect(result.latest).toBe("1.0.0");
      expect(result.isOutdated).toBe(true);
    });

    it("should handle latest tag comparison", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ tags: ["0.1.0", "latest"] }),
          }),
        );

      const result = await versionService.getVersionInfo("latest");

      expect(result.latest).toBe("0.1.0");
      expect(result.isOutdated).toBe(true);
    });

    it("should handle versions with missing parts", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ tags: ["1.0.0", "1.0.1", "1.1.0", "2.0.0"] }),
          }),
        );

      const result = await versionService.getVersionInfo("1.0.5");

      expect(result.latest).toBe("2.0.0");
      expect(result.isOutdated).toBe(true);
    });

    it("should handle equal versions", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ token: "test-token" }),
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ tags: ["1.0.0", "1.0.0"] }),
          }),
        );

      const result = await versionService.getVersionInfo("1.0.0");

      expect(result.latest).toBe("1.0.0");
      expect(result.isOutdated).toBe(false);
    });
  });
});
