import { useEffect, useState } from "react";
import type { StatusResponse } from "@open-resource-discovery/explorer/components";

function isStatusResponse(value: unknown): value is StatusResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["version"] === "string" &&
    typeof (value as Record<string, unknown>)["versionInfo"] === "object" &&
    (value as Record<string, unknown>)["versionInfo"] !== null
  );
}

export function useStatusWebSocket(): StatusResponse | undefined {
  const [status, setStatus] = useState<StatusResponse | undefined>(undefined);

  useEffect((): (() => void) => {
    let ws: WebSocket | undefined;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    function connect(): void {
      fetch("/api/v1/status")
        .then((r: Response): Promise<unknown> => r.json())
        .then((data: unknown): void => {
          if (!cancelled && isStatusResponse(data)) {
            setStatus(data);
          }
        })
        .catch((err: unknown): void => {
          // eslint-disable-next-line no-console
          console.warn("[ws] initial fetch failed", err);
        });

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/ws`);

      ws.onmessage = (event: MessageEvent): void => {
        try {
          // SAFETY: only `.type` (string) and `.data` (unknown) are read before further narrowing.
          const msg = JSON.parse(String(event.data)) as {
            type: string;
            data?: unknown;
          };
          if (msg.type === "status" && msg.data !== undefined) {
            setStatus((prev: StatusResponse | undefined): StatusResponse => {
              if (prev !== undefined) {
                // SAFETY: WS "status" messages are server-emitted Partial<StatusResponse>; narrowed in ticket 06.
                const partial = msg.data as Partial<StatusResponse>;
                return { ...prev, ...partial };
              }
              // SAFETY: WS "status" messages are server-emitted StatusResponse; narrowed in ticket 06.
              return msg.data as StatusResponse;
            });
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = (event: Event): void => {
        // eslint-disable-next-line no-console
        console.warn("[ws] error", event);
      };

      ws.onclose = (): void => {
        if (!cancelled) {
          reconnectTimeout = setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return (): void => {
      cancelled = true;
      clearTimeout(reconnectTimeout);
      ws?.close();
    };
  }, []);

  return status;
}
