import { useEffect, useRef } from "react";
import { useGitStore } from "../stores/gitStore";
import { useAgentFileTrackingStore } from "../../files";
import type { GitStatus } from "../../../lib/tauri/commands";

/** Fingerprint for detecting meaningful status changes beyond just isDirty.
 *  Includes modifiedPaths length to catch file-set changes that preserve counts
 *  (e.g. commit file A + modify file B = same counts, different paths). */
function statusFingerprint(s: GitStatus): string {
  return `${s.isDirty}:${s.stagedCount}:${s.unstagedCount}:${s.untrackedCount}:${s.modifiedPaths.length}`;
}

/** How many polling ticks between automatic `git fetch` calls. */
const FETCH_EVERY_N_TICKS = 3; // 3 × 10s = 30s

/**
 * Polls git data at an interval when the git tab is active.
 * - Every tick: compare status fingerprint → refresh graph if changed.
 * - Every Nth tick: run `git fetch --all --prune` then refresh graph
 *   unconditionally so remote tracking refs are up-to-date.
 *
 * Sleep/wake resilience:
 * - `inFlightRef` prevents callback stacking when stale IPC calls pile up after wake.
 * - Listens for `app:wake` to clear and restart the interval, avoiding burst execution.
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
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!isActive || !projectPath) return;

    // Reset tick counter when dependencies change
    tickRef.current = 0;

    fetchGraphData(projectId, projectPath).catch((e) => {
      console.error("[useGitPolling] Initial fetch failed:", e);
    });

    // ── Polling tick ──────────────────────────────────────────────
    const tick = async () => {
      if (inFlightRef.current) return; // prevent overlapping async callbacks
      inFlightRef.current = true;
      try {
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
            useAgentFileTrackingStore
              .getState()
              .reconcileWithGitStatus(projectPath, status.modifiedPaths);
          }
        } else {
          // Normal tick: only refresh graph if local status changed
          const status = await refreshStatus(projectPath);
          if (!status) return;

          // Always reconcile working set — file-set can change without
          // count changes (e.g. commit A + modify B = same counts).
          useAgentFileTrackingStore
            .getState()
            .reconcileWithGitStatus(projectPath, status.modifiedPaths);

          const fp = statusFingerprint(status);
          const changed = lastFingerprintRef.current !== fp;
          lastFingerprintRef.current = fp;

          if (changed) {
            fetchGraphData(projectId, projectPath).catch((e) => {
              console.error("[useGitPolling] Graph refresh failed:", e);
            });
          }
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    // ── Interval management with wake recovery ───────────────────
    // Use a mutable ref-holder so the wake handler can clear & restart.
    let intervalId = setInterval(tick, intervalMs);
    let wakeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleWake = () => {
      console.info("[useGitPolling] Wake detected — resetting interval");
      clearInterval(intervalId);
      if (wakeTimeoutId !== null) clearTimeout(wakeTimeoutId);
      tickRef.current = 0;
      // Do NOT force inFlightRef to false — let any in-flight tick complete
      // naturally via its finally block to avoid concurrent tick execution.
      // Small delay lets the system stabilise before resuming IPC calls
      wakeTimeoutId = setTimeout(() => {
        wakeTimeoutId = null;
        intervalId = setInterval(tick, intervalMs);
        // Trigger one immediate refresh after wake
        tick().catch((e) => {
          console.error("[useGitPolling] Post-wake tick failed:", e);
        });
      }, 1000);
    };

    window.addEventListener("app:wake", handleWake);

    return () => {
      clearInterval(intervalId);
      if (wakeTimeoutId !== null) clearTimeout(wakeTimeoutId);
      window.removeEventListener("app:wake", handleWake);
    };
  }, [projectId, projectPath, isActive, intervalMs, fetchGraphData, refreshStatus, fetchRemote]);
}
