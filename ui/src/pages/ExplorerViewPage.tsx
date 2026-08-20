import type { ReactNode } from "react";
import { useParams } from "@tanstack/react-router";
import { ExplorerPage } from "@open-resource-discovery/explorer/components";
import { ORD_CONFIG_URL } from "../constants";

export function ExplorerViewPage(): ReactNode {
  const { perspId } = useParams({ from: "/status/$perspId" });
  const absoluteOrdConfigUrl = `${window.location.origin}${ORD_CONFIG_URL}`;
  return <ExplorerPage ordConfigUrl={absoluteOrdConfigUrl} perspectiveId={perspId} />;
}
