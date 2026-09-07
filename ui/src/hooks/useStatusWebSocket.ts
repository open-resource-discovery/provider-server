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

function isStatusResponse(v: unknown): v is StatusResponse {
  return typeof v === "object" && v !== null;
}

function isUpdateProgress(v: unknown): v is UpdateProgress {
  return typeof v === "object" && v !== null;
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
            if (isStatusResponse(data)) {
              setStatus(data);
            } else {
              // eslint-disable-next-line no-console
              console.warn("[ws] unexpected status shape from /api/v1/status", data);
            }
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
            if (isStatusResponse(incoming)) {
              setStatus((prev: StatusResponse | undefined): StatusResponse => {
                if (prev !== undefined) {
                  return { ...prev, ...incoming };
                }
                return incoming;
              });
            } else {
              // eslint-disable-next-line no-console
              console.warn("[ws] unexpected status message payload", incoming);
            }
          } else if (raw.type === "update-progress" && raw.data !== undefined) {
            if (isUpdateProgress(raw.data)) {
              setUpdateProgress(raw.data);
            } else {
              // eslint-disable-next-line no-console
              console.warn("[ws] unexpected update-progress payload", raw.data);
            }
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
