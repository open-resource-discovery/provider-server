import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ServerStatusPanel, ConnectionDetailPage } from "@open-resource-discovery/explorer/components";
import type { Perspective } from "@open-resource-discovery/explorer/components";
import { useStatusWebSocket } from "../hooks/useStatusWebSocket";
import { useProviderPerspectives } from "../hooks/usePerspectives";
import { ORD_CONFIG_URL } from "../constants";

export function StatusHubPage(): ReactNode {
  const status = useStatusWebSocket();
  const [perspectivesState, onRefresh] = useProviderPerspectives();

  return (
    <div>
      {status !== undefined && <ServerStatusPanel status={status} />}
      <ConnectionDetailPage
        ordConfigUrl={ORD_CONFIG_URL}
        connectionName="ORD Provider Server"
        auth="none"
        perspectivesState={perspectivesState}
        onRefresh={onRefresh}
        renderPerspectiveAction={(perspective: Perspective): ReactNode => (
          <Link to="/status/$perspId" params={{ perspId: perspective.id }}>
            Explore
          </Link>
        )}
      />
    </div>
  );
}
