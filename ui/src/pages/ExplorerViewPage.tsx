import type { ReactNode } from "react";
import { useParams } from "@tanstack/react-router";
import { ExplorerPage } from "@open-resource-discovery/explorer/components";

export function ExplorerViewPage(): ReactNode {
  const { perspId } = useParams({ from: "/status/$perspId" });
  return <ExplorerPage ordConfigUrl="/.well-known/open-resource-discovery" perspectiveId={perspId} />;
}
