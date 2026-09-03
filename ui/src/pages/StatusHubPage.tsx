import { type ReactNode, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ServerStatusPanel,
  ConnectionDetailSection,
  type Perspective,
} from "@open-resource-discovery/explorer/components";
import { useStatusWebSocket, type UpdateProgress } from "../hooks/useStatusWebSocket";
import { useProviderPerspectives } from "../hooks/usePerspectives";
import { ORD_CONFIG_URL, WEBHOOK_PATH } from "../constants";
import { assertNever } from "../utils";

type UpdateStatus = "idle" | "scheduled" | "in_progress" | "failed" | "cache_warming";

const GIT_PREFIXES = [
  "Receiving objects:",
  "Resolving deltas:",
  "Downloading objects:",
  "Checking out files:",
  "Analyzing workdir:",
  "Updating workdir:",
  "Counting objects:",
] as const;

function getProgressText(progress: UpdateProgress): string {
  let text = "";

  const currentFile = progress.currentFile;
  if (currentFile !== undefined) {
    const isGit = GIT_PREFIXES.some((p: string): boolean => currentFile.includes(p));
    if (isGit) {
      text = currentFile;
    } else if (!currentFile.includes("git objects")) {
      text = currentFile.split("/").pop() ?? "";
    }
  }

  if (text === "" && progress.totalFiles !== undefined && progress.fetchedFiles !== undefined) {
    if (progress.totalFiles < 20000 || progress.fetchedFiles > progress.totalFiles / 2) {
      const percentage = Math.round((progress.fetchedFiles / progress.totalFiles) * 100);
      text = `Fetching files: ${progress.fetchedFiles}/${progress.totalFiles} (${percentage}%)`;
    }
  }

  const errors = progress.errors;
  if (errors !== undefined && errors.length > 0) {
    text += ` [${errors.length} errors]`;
  }

  return text.trim();
}

function getTriggerButtonLabel(updateStatus: UpdateStatus | undefined, isTriggering: boolean): string {
  if (isTriggering) return "Scheduling…";
  if (updateStatus === undefined || updateStatus === "idle" || updateStatus === "failed") {
    return "Trigger Update";
  }
  switch (updateStatus) {
    case "scheduled":
      return "Update Scheduled";
    case "in_progress":
      return "Fetching…";
    case "cache_warming":
      return "Warming Cache…";
    default:
      return assertNever(updateStatus);
  }
}

export function StatusHubPage(): ReactNode {
  const { status, updateProgress } = useStatusWebSocket();
  const [perspectivesState] = useProviderPerspectives();
  const [isTriggering, setIsTriggering] = useState<boolean>(false);

  const updateStatus = status?.content?.updateStatus;
  const sourceType = status?.settings?.sourceType;
  const showTriggerButton = sourceType !== undefined && sourceType !== "local";
  const buttonDisabled =
    isTriggering || (updateStatus !== undefined && updateStatus !== "idle" && updateStatus !== "failed");

  const progressText =
    updateStatus === "in_progress" && updateProgress !== undefined ? getProgressText(updateProgress) : "";

  useEffect((): void => {
    if (updateStatus !== undefined && updateStatus !== "idle" && updateStatus !== "failed") {
      setIsTriggering(false);
    }
  }, [updateStatus]);

  async function handleTriggerUpdate(): Promise<void> {
    setIsTriggering(true);
    try {
      const response = await fetch(WEBHOOK_PATH, {
        method: "POST",
        headers: { "x-manual-trigger": "true" },
      });
      if (!response.ok) {
        setIsTriggering(false);
      }
    } catch {
      setIsTriggering(false);
    }
  }

  return (
    <div>
      {status !== undefined && (
        <ServerStatusPanel
          status={status}
          headerActions={
            showTriggerButton ? (
              <button
                onClick={handleTriggerUpdate}
                disabled={buttonDisabled}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M8 16H3v5" />
                </svg>
                {getTriggerButtonLabel(updateStatus, isTriggering)}
              </button>
            ) : null
          }
          afterContent={
            progressText !== "" ? (
              <p className="text-sm text-muted-foreground">{progressText}</p>
            ) : null
          }
          footerContent={
            <ConnectionDetailSection
              showHeader={false}
              showStatusBadge={false}
              ordConfigUrl={ORD_CONFIG_URL}
              connectionName="ORD Provider Server"
              perspectivesState={perspectivesState}
              renderPerspectiveAction={(perspective: Perspective): ReactNode => (
                <Link
                  to="/status/$perspId"
                  params={{ perspId: perspective.id }}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                  Explore
                </Link>
              )}
            />
          }
        />
      )}
    </div>
  );
}
