import { useEffect, useRef } from "react";
import { useGitStore } from "../stores/gitStore";
import type { GitStatus } from "../../../lib/tauri/commands";

/** Fingerprint for detecting meaningful status changes beyond just isDirty */
function statusFingerprint(s: GitStatus): string {
  return `${s.isDirty}:${s.stagedCount}:${s.unstagedCount}:${s.untrackedCount}`;
}

/** How many polling ticks between automatic `git fetch` calls. */
const FETCH_EVERY_N_TICKS = 3; // 3 × 10s = 30s

/**
 * Polls git data at an interval when the git tab is active.
 * - Every tick: compare status fingerprint → refresh graph if changed.
 * - Every Nth tick: run `git fetch --all --prune` then refresh graph
 *   unconditionally so remote tracking refs are up-to-date.
 */
export function useGitPolling(
  projectId: string,
  projectPath: string,
  isActive: boolean,
  intervalMs: number = 10000,
): void {
  const fetchGraphData = useGitStore((s) => s.fetchGraphData);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const fetchRemote = useGitStore((s) => s.fetchRemote);
  const lastFingerprintRef = useRef<string | null>(null);
  const tickRef = useRef(0);

  useEffect(() => {
    if (!isActive || !projectPath) return;

    // Reset tick counter when dependencies change
    tickRef.current = 0;

    fetchGraphData(projectId, projectPath).catch((e) => {
      console.error("[useGitPolling] Initial fetch failed:", e);
    });

    const id = setInterval(async () => {
      tickRef.current += 1;
      const isFetchTick = tickRef.current % FETCH_EVERY_N_TICKS === 0;

      if (isFetchTick) {
        // Fetch from remotes, then unconditionally refresh graph
        await fetchRemote(projectPath);
        await fetchGraphData(projectId, projectPath).catch((e) => {
          console.error("[useGitPolling] Post-fetch graph refresh failed:", e);
        });
        // Update fingerprint baseline so the next normal tick doesn't
        // trigger a redundant refresh
        const status = await refreshStatus(projectPath);
        if (status) {
          lastFingerprintRef.current = statusFingerprint(status);
        }
      } else {
        // Normal tick: only refresh if local status changed
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
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [projectId, projectPath, isActive, intervalMs, fetchGraphData, refreshStatus, fetchRemote]);
}
