import { useCallback, useEffect, useState } from "react";
import type { OrdConfiguration } from "@open-resource-discovery/specification";
import type { Perspective, PerspectivesState } from "@open-resource-discovery/explorer/components";
import { ORD_CONFIG_URL } from "../constants";

const DEFAULT_PERSPECTIVE = "system-instance";

function buildPerspectives(config: OrdConfiguration): Perspective[] {
  const entries = config.openResourceDiscoveryV1?.documents ?? [];
  const perspMap = new Map<string, { url: string }[]>();
  const perspOrder: string[] = [];

  for (const entry of entries) {
    // SAFETY: ORD document entries carry a 'perspective' extension field not declared in
    // the upstream OrdConfiguration type; we cast to Record<string,unknown> to read it and
    // narrow with typeof before use.
    const raw = entry as unknown as Record<string, unknown>;
    const id = typeof raw["perspective"] === "string" ? raw["perspective"] : DEFAULT_PERSPECTIVE;
    if (!perspMap.has(id)) {
      perspMap.set(id, []);
      perspOrder.push(id);
    }
    if (entry.url?.trim()) {
      const docs = perspMap.get(id);
      if (docs !== undefined) {
        docs.push({ url: entry.url });
      }
    }
  }

  return perspOrder.map((id) => ({
    id,
    documents: perspMap.get(id) ?? [],
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
        // SAFETY: ORD_CONFIG_URL is a server-controlled endpoint that always returns OrdConfiguration-shaped JSON.
        const config = (await res.json()) as OrdConfiguration;
        const perspectives = buildPerspectives(config);
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
