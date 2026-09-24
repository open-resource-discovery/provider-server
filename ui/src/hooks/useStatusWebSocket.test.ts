import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useStatusWebSocket } from "./useStatusWebSocket";
import { WS_PATH } from "../constants";

// A minimal stand-in for the browser WebSocket. The hook only assigns the three
// handlers and calls close(); this records constructed instances and lets a test
// drive onmessage / onclose the way the real socket would.
class FakeWebSocket {
  public static instances: FakeWebSocket[] = [];
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: (() => void) | null = null;
  public readonly url: string;
  public readonly close = vi.fn((): void => {});

  public constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  public emitMessage(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  public emitRawMessage(raw: string): void {
    this.onmessage?.(new MessageEvent("message", { data: raw }));
  }

  public emitClose(): void {
    this.onclose?.();
  }
}

// A real Response the initial-seed fetch can consume: the hook reads only .json().
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

// A fetch that never settles — keeps `status` undefined so a test isolates WS behaviour
// from the initial HTTP seed.
function pendingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((): Promise<Response> => new Promise<Response>((): void => {}));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach((): void => {
  FakeWebSocket.instances = [];
  fetchMock = pendingFetch();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach((): void => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useStatusWebSocket", () => {
  describe("initial HTTP seed", () => {
    it("seeds status from GET /api/v1/status", async (): Promise<void> => {
      const seed = { version: "1.2.3" };
      fetchMock.mockReturnValueOnce(Promise.resolve(jsonResponse(seed)));

      const { result } = renderHook(() => useStatusWebSocket());

      await waitFor((): void => {
        expect(result.current.status).toEqual(seed);
      });
      expect(fetchMock).toHaveBeenCalledWith("/api/v1/status");
    });

    it("ignores a seed whose shape fails the guard", async (): Promise<void> => {
      fetchMock.mockReturnValueOnce(Promise.resolve(jsonResponse({})));

      const { result } = renderHook(() => useStatusWebSocket());

      // Let the fetch microtasks drain, then confirm nothing was written.
      await act(async (): Promise<void> => {
        await Promise.resolve();
      });
      expect(result.current.status).toBeUndefined();
    });
  });

  describe("WebSocket URL construction", () => {
    it("targets window.location.host with the ws: protocol", (): void => {
      renderHook(() => useStatusWebSocket());

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(FakeWebSocket.instances[0]?.url).toBe(`ws://${window.location.host}${WS_PATH}`);
    });
  });

  describe("message routing", () => {
    it("applies a status message and merges later patches onto it", (): void => {
      const { result } = renderHook(() => useStatusWebSocket());
      const socket = FakeWebSocket.instances[0];
      expect(socket).toBeDefined();

      act((): void => {
        socket?.emitMessage({ type: "status", data: { version: "1.0.0" } });
      });
      expect(result.current.status).toEqual({ version: "1.0.0" });

      // A partial patch (no `version`) must merge onto the previous status, not replace it.
      act((): void => {
        socket?.emitMessage({ type: "status", data: { systemMetrics: { cpu: 1 } } });
      });
      expect(result.current.status).toEqual({ version: "1.0.0", systemMetrics: { cpu: 1 } });
    });

    it("routes an update-progress message to updateProgress only", (): void => {
      const { result } = renderHook(() => useStatusWebSocket());
      const socket = FakeWebSocket.instances[0];

      act((): void => {
        socket?.emitMessage({ type: "update-progress", data: { fetchedFiles: 2, totalFiles: 5 } });
      });
      expect(result.current.updateProgress).toEqual({ fetchedFiles: 2, totalFiles: 5 });
      expect(result.current.status).toBeUndefined();
    });

    it.each([
      { label: "empty object", data: {} },
      { label: "array", data: [1, 2] },
      { label: "null", data: null },
      { label: "wrong field type", data: { version: 123 } },
    ])("rejects a status payload that is $label", ({ data }): void => {
      const { result } = renderHook(() => useStatusWebSocket());
      const socket = FakeWebSocket.instances[0];

      act((): void => {
        socket?.emitMessage({ type: "status", data });
      });
      expect(result.current.status).toBeUndefined();
    });

    it("ignores a non-message frame and malformed JSON without throwing", (): void => {
      const { result } = renderHook(() => useStatusWebSocket());
      const socket = FakeWebSocket.instances[0];

      act((): void => {
        socket?.emitMessage([1, 2, 3]); // valid JSON, but not a WsMessage
        socket?.emitMessage({ data: { version: "9" } }); // missing `type`
        socket?.emitRawMessage("}{ not json");
      });
      expect(result.current.status).toBeUndefined();
      expect(result.current.updateProgress).toBeUndefined();
    });
  });

  describe("reconnection", () => {
    it("reconnects 3s after the socket closes", (): void => {
      vi.useFakeTimers();
      renderHook(() => useStatusWebSocket());
      expect(FakeWebSocket.instances).toHaveLength(1);

      act((): void => {
        FakeWebSocket.instances[0]?.emitClose();
      });
      // No immediate reconnect...
      expect(FakeWebSocket.instances).toHaveLength(1);

      act((): void => {
        vi.advanceTimersByTime(3000);
      });
      // ...a fresh socket only after the backoff elapses.
      expect(FakeWebSocket.instances).toHaveLength(2);
    });
  });

  describe("cleanup on unmount", () => {
    it("closes the socket and cancels any pending reconnect", (): void => {
      vi.useFakeTimers();
      const { unmount } = renderHook(() => useStatusWebSocket());
      const socket = FakeWebSocket.instances[0];
      expect(socket).toBeDefined();

      unmount();
      expect(socket?.close).toHaveBeenCalledTimes(1);

      // A close firing after unmount must not schedule a reconnect.
      act((): void => {
        socket?.emitClose();
        vi.advanceTimersByTime(3000);
      });
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });
});
