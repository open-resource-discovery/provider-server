import { useEffect, useState } from "react";
import type { StatusResponse } from "@open-resource-discovery/explorer/components";
import { WS_PATH } from "../constants";

interface WsMessage {
  type: string;
  data?: unknown;
}

export interface UpdateProgress {
  fetchedFiles?: number;
  totalFiles?: number;
  currentFile?: string;
  errors?: readonly string[];
}

export interface UseStatusWebSocketResult {
  status: StatusResponse | undefined;
  updateProgress: UpdateProgress | undefined;
}

function isWsMessage(v: unknown): v is WsMessage {
  return (
    typeof v === "object" && v !== null && "type" in v && typeof (v as Record<string, unknown>)["type"] === "string"
  );
}

export function useStatusWebSocket(): UseStatusWebSocketResult {
  const [status, setStatus] = useState<StatusResponse | undefined>(undefined);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | undefined>(undefined);

  useEffect((): (() => void) => {
    let ws: WebSocket | undefined;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    function connect(): void {
      fetch("/api/v1/status")
        .then((r: Response): Promise<unknown> => r.json())
        .then((data: unknown): void => {
          if (!cancelled) {
            // SAFETY: /api/v1/status always returns a StatusResponse-shaped payload per server contract.
            setStatus(data as StatusResponse);
          }
        })
        .catch((err: unknown): void => {
          // eslint-disable-next-line no-console
          console.warn("[ws] initial fetch failed", err);
        });

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}${WS_PATH}`);

      ws.onmessage = (event: MessageEvent): void => {
        try {
          const raw: unknown = JSON.parse(String(event.data));
          if (!isWsMessage(raw)) return;
          if (raw.type === "status" && raw.data !== undefined) {
            const incoming = raw.data;
            setStatus((prev: StatusResponse | undefined): StatusResponse => {
              if (prev !== undefined) {
                // SAFETY: type === "status" messages carry a StatusResponse-shaped payload per server contract.
                return { ...prev, ...(incoming as Partial<StatusResponse>) };
              }
              // SAFETY: type === "status" messages carry a StatusResponse-shaped payload per server contract.
              return incoming as StatusResponse;
            });
          } else if (raw.type === "update-progress" && raw.data !== undefined) {
            // SAFETY: type === "update-progress" messages carry an UpdateProgress-shaped payload per server contract.
            setUpdateProgress(raw.data as UpdateProgress);
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

  return { status, updateProgress };
}
