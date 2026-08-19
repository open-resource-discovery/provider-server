import type { ReactNode } from "react";
import { useParams } from "@tanstack/react-router";
import { ExplorerPage } from "@open-resource-discovery/explorer/components";
import { ORD_CONFIG_URL } from "../constants";

export function ExplorerViewPage(): ReactNode {
  const { perspId } = useParams({ from: "/status/$perspId" });
  return <ExplorerPage ordConfigUrl={ORD_CONFIG_URL} perspectiveId={perspId} />;
}
