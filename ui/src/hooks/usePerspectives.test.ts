import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useProviderPerspectives } from "./usePerspectives";
import { ORD_CONFIG_URL } from "../constants";

// A real Response: the hook reads .ok, .status and .json(), all derived from status here.
function jsonResponse(body: unknown, init?: { status?: number }): Response {
  const status = init?.status ?? 200;
  return new Response(JSON.stringify(body), { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach((): void => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach((): void => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useProviderPerspectives", () => {
  it("fetches the ORD config endpoint (resolved relative to the page origin)", async (): Promise<void> => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ openResourceDiscoveryV1: { documents: [] } }));

    const { result } = renderHook(() => useProviderPerspectives());

    await waitFor((): void => {
      expect(result.current[0].status).toBe("ready");
    });
    expect(fetchMock).toHaveBeenCalledWith(ORD_CONFIG_URL);
  });

  it("parses documents into grouped perspectives via the typed predicate", async (): Promise<void> => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        openResourceDiscoveryV1: {
          documents: [
            { perspective: "system-instance", url: "https://a" },
            { url: "https://b" }, // no perspective → defaults to system-instance
            { perspective: "system-version", url: "https://c" },
          ],
        },
      }),
    );

    const { result } = renderHook(() => useProviderPerspectives());

    await waitFor((): void => {
      expect(result.current[0].status).toBe("ready");
    });
    expect(result.current[0]).toMatchObject({
      status: "ready",
      perspectives: [
        { id: "system-instance", documents: [{ url: "https://a" }, { url: "https://b" }] },
        { id: "system-version", documents: [{ url: "https://c" }] },
      ],
    });
  });

  it("enters the error state on a non-ok response without throwing", async (): Promise<void> => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 500 }));

    const { result } = renderHook(() => useProviderPerspectives());

    await waitFor((): void => {
      expect(result.current[0].status).toBe("error");
    });
    const state = result.current[0];
    expect(state.status === "error" && state.error).toContain("500");
  });

  it("enters the error state when the fetch rejects", async (): Promise<void> => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useProviderPerspectives());

    await waitFor((): void => {
      expect(result.current[0].status).toBe("error");
    });
    const state = result.current[0];
    expect(state.status === "error" && state.error).toBe("network down");
  });

  it("enters the error state when the config shape is unexpected", async (): Promise<void> => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ openResourceDiscoveryV1: { documents: "nope" } }));

    const { result } = renderHook(() => useProviderPerspectives());

    await waitFor((): void => {
      expect(result.current[0].status).toBe("error");
    });
  });

  it("refetches when the returned refetch callback is invoked", async (): Promise<void> => {
    fetchMock.mockResolvedValue(jsonResponse({ openResourceDiscoveryV1: { documents: [] } }));

    const { result } = renderHook(() => useProviderPerspectives());
    await waitFor((): void => {
      expect(result.current[0].status).toBe("ready");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act((): void => {
      result.current[1]();
    });
    await waitFor((): void => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
