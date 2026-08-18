import { useEffect, useState } from "react";
import type { StatusResponse } from "@open-resource-discovery/explorer/components";

export function useStatusWebSocket(): StatusResponse | undefined {
  const [status, setStatus] = useState<StatusResponse | undefined>(undefined);

  useEffect((): (() => void) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/ws`);

    ws.onmessage = (event: MessageEvent): void => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type: string;
          data?: unknown;
        };
        if (msg.type === "status" && msg.data !== undefined) {
          setStatus((prev) =>
            prev !== undefined ? { ...prev, ...(msg.data as Partial<StatusResponse>) } : (msg.data as StatusResponse),
          );
        }
      } catch {
        // ignore parse errors
      }
    };

    return (): void => {
      ws.close();
    };
  }, []);

  return status;
}
