import { useCallback, useEffect, useState } from "react";
import type { Perspective, PerspectivesState } from "@open-resource-discovery/explorer/components";
import { ORD_CONFIG_URL } from "../constants";

const DEFAULT_PERSPECTIVE = "system-instance";

interface OrdConfigShape {
  openResourceDiscoveryV1?: {
    documents?: Record<string, unknown>[];
  };
}

function isOrdConfigShape(v: unknown): v is OrdConfigShape {
  if (typeof v !== "object" || v === null) return false;
  // SAFETY: v is a non-null object; casting to Record<string,unknown> to read optional fields.
  const r = v as Record<string, unknown>;
  if (!("openResourceDiscoveryV1" in r)) return true;
  const v1 = r["openResourceDiscoveryV1"];
  if (typeof v1 !== "object" || v1 === null) return false;
  // SAFETY: v1 is a non-null object; casting to Record<string,unknown> to read the documents field.
  const docs = (v1 as Record<string, unknown>)["documents"];
  return docs === undefined || Array.isArray(docs);
}

function buildPerspectives(config: OrdConfigShape): Perspective[] {
  const entries = config.openResourceDiscoveryV1?.documents ?? [];
  const perspMap = new Map<string, { url: string }[]>();
  const perspOrder: string[] = [];

  for (const entry of entries) {
    const id = typeof entry["perspective"] === "string" ? entry["perspective"] : DEFAULT_PERSPECTIVE;
    const url = entry["url"];
    let docs = perspMap.get(id);
    if (docs === undefined) {
      docs = [];
      perspMap.set(id, docs);
      perspOrder.push(id);
    }
    if (typeof url === "string" && url.trim()) {
      docs.push({ url });
    }
  }

  return perspOrder.map((id) => ({
    id,
    // SAFETY: perspOrder is populated in lockstep with perspMap; every id in the order was set in the map.
    documents: perspMap.get(id) as { url: string }[],
  }));
}

export function useProviderPerspectives(): [PerspectivesState, () => void] {
  const [state, setState] = useState<PerspectivesState>({ status: "loading" });
  const [retryCount, setRetryCount] = useState(0);

  const refetch = useCallback((): void => {
    setRetryCount((c) => c + 1);
  }, []);

  useEffect((): (() => void) => {
    let cancelled = false;
    setState({ status: "loading" });

    async function load(): Promise<void> {
      try {
        const res = await fetch(ORD_CONFIG_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status.toString()}`);
        const raw: unknown = await res.json();
        if (!isOrdConfigShape(raw)) throw new Error("Unexpected ORD config shape");
        const perspectives = buildPerspectives(raw);
        if (!cancelled) {
          setState({ status: "ready", perspectives, fetchedAt: new Date() });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    void load();
    return (): void => {
      cancelled = true;
    };
  }, [retryCount]);

  return [state, refetch];
}
