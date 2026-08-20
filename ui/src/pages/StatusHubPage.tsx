import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ServerStatusPanel, ConnectionDetailPage } from "@open-resource-discovery/explorer/components";
import type { Perspective } from "@open-resource-discovery/explorer/components";
import { useStatusWebSocket } from "../hooks/useStatusWebSocket";
import { useProviderPerspectives } from "../hooks/usePerspectives";
import { ORD_CONFIG_URL, WEBHOOK_PATH } from "../constants";
import { assertNever } from "../utils";

type UpdateStatus = "idle" | "scheduled" | "in_progress" | "failed" | "cache_warming";

function getTriggerButtonLabel(
  updateStatus: UpdateStatus | undefined,
  isTriggering: boolean,
): string {
  if (isTriggering) return "Scheduling…";
  if (updateStatus === undefined || updateStatus === "idle" || updateStatus === "failed") {
    return "Trigger Update";
  }
  switch (updateStatus) {
    case "scheduled": return "Update Scheduled";
    case "in_progress": return "Fetching…";
    case "cache_warming": return "Warming Cache…";
    default: return assertNever(updateStatus);
  }
}

export function StatusHubPage(): ReactNode {
  const status = useStatusWebSocket();
  const [perspectivesState, onRefresh] = useProviderPerspectives();
  const [isTriggering, setIsTriggering] = useState<boolean>(false);

  const updateStatus = status?.content?.updateStatus;
  const sourceType = status?.settings?.sourceType;
  const showTriggerButton = sourceType !== undefined && sourceType !== "local";
  const buttonDisabled =
    isTriggering ||
    (updateStatus !== undefined && updateStatus !== "idle" && updateStatus !== "failed");

  useEffect((): void => {
    if (
      updateStatus !== undefined &&
      updateStatus !== "idle" &&
      updateStatus !== "failed"
    ) {
      setIsTriggering(false);
    }
  }, [updateStatus]);

  async function handleTriggerUpdate(): Promise<void> {
    setIsTriggering(true);
    try {
      await fetch(WEBHOOK_PATH, {
        method: "POST",
        headers: { "x-manual-trigger": "true" },
      });
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error("Failed to trigger update:", e.message);
      }
      setIsTriggering(false);
    }
  }

  return (
    <div>
      {status !== undefined && <ServerStatusPanel status={status} />}
      {showTriggerButton && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleTriggerUpdate}
            disabled={buttonDisabled}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {getTriggerButtonLabel(updateStatus, isTriggering)}
          </button>
        </div>
      )}
      <ConnectionDetailPage
        ordConfigUrl={ORD_CONFIG_URL}
        connectionName="ORD Provider Server"
        auth="none"
        perspectivesState={perspectivesState}
        onRefresh={onRefresh}
        renderPerspectiveAction={(perspective: Perspective): ReactNode => (
          <Link
            to="/status/$perspId"
            params={{ perspId: perspective.id }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Explore
          </Link>
        )}
      />
    </div>
  );
}
