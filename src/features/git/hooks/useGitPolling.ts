import { useEffect, useRef } from "react";
import { useGitStore } from "../stores/gitStore";
import type { GitStatus } from "../../../lib/tauri/commands";

/** Fingerprint for detecting meaningful status changes beyond just isDirty */
function statusFingerprint(s: GitStatus): string {
  return `${s.isDirty}:${s.stagedCount}:${s.unstagedCount}:${s.untrackedCount}`;
}

/**
 * Polls git data at an interval when the git tab is active.
 * Triggers a full graph refresh when the status fingerprint changes.
 */
export function useGitPolling(
  projectId: string,
  projectPath: string,
  isActive: boolean,
  intervalMs: number = 10000,
): void {
  const fetchGraphData = useGitStore((s) => s.fetchGraphData);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const lastFingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isActive || !projectPath) return;

    fetchGraphData(projectId, projectPath).catch((e) => {
      console.error("[useGitPolling] Initial fetch failed:", e);
    });

    const id = setInterval(async () => {
      const status = await refreshStatus(projectPath);
      if (!status) return;

      const fp = statusFingerprint(status);
      const changed = lastFingerprintRef.current !== fp;
      lastFingerprintRef.current = fp;

      if (changed) {
        fetchGraphData(projectId, projectPath).catch((e) => {
          console.error("[useGitPolling] Graph refresh failed:", e);
        });
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [projectId, projectPath, isActive, intervalMs, fetchGraphData, refreshStatus]);
}
