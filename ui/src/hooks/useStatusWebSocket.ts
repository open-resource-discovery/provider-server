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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isWsMessage(v: unknown): v is WsMessage {
  return isRecord(v) && typeof v["type"] === "string";
}

// The WS "status" message carries either a full StatusResponse or a partial patch:
// sendFullStatusDelayed broadcasts only { versionInfo, systemMetrics } with no `version`,
// and the hook merges patches onto the previous status. So this guard deliberately
// accepts partial shapes — it rejects non-objects, arrays and empty/unrelated objects
// (e.g. {}, class instances), and type-checks every StatusResponse field that is present.
function isStatusResponse(v: unknown): v is StatusResponse {
  if (!isRecord(v)) return false;
  if ("version" in v && typeof v["version"] !== "string") return false;
  if ("versionInfo" in v && !isRecord(v["versionInfo"])) return false;
  if ("content" in v && !isRecord(v["content"])) return false;
  if ("settings" in v && !isRecord(v["settings"])) return false;
  if ("systemMetrics" in v && !isRecord(v["systemMetrics"])) return false;
  // Require at least one recognised field so {} and unrelated objects are rejected.
  return "version" in v || "versionInfo" in v || "content" in v || "settings" in v || "systemMetrics" in v;
}

// UpdateProgress fields are all optional, so this guard type-checks every field that is
// present and requires at least one recognised field — rejecting {}, arrays and unrelated objects.
function isUpdateProgress(v: unknown): v is UpdateProgress {
  if (!isRecord(v)) return false;
  if ("fetchedFiles" in v && typeof v["fetchedFiles"] !== "number") return false;
  if ("totalFiles" in v && typeof v["totalFiles"] !== "number") return false;
  if ("currentFile" in v && typeof v["currentFile"] !== "string") return false;
  if ("errors" in v && !Array.isArray(v["errors"])) return false;
  return "fetchedFiles" in v || "totalFiles" in v || "currentFile" in v || "errors" in v;
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
