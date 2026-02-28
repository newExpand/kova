import { useEffect, useRef } from "react";
import { useSshGitStore } from "../stores/sshGitStore";

const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Polls SSH remote git data at an interval when the SSH git tab is active.
 *
 * Simplified version of useGitPolling:
 * - No fingerprint-based smart refresh (no cheap remote status check)
 * - No git fetch (read-only view of remote repo)
 * - 30-second default interval (SSH calls are heavier than local git)
 * - `inFlightRef` prevents overlapping SSH calls
 * - Stops polling after MAX_CONSECUTIVE_FAILURES to avoid hammering a dead server
 * - Listens for `app:wake` event for sleep/wake recovery
 */
export function useSshGitPolling(
  connectionId: string,
  isActive: boolean,
  intervalMs: number = 30000,
): void {
  const fetchGraphData = useSshGitStore((s) => s.fetchGraphData);
  const inFlightRef = useRef(false);
  const consecutiveFailures = useRef(0);

  useEffect(() => {
    if (!isActive || !connectionId) return;

    consecutiveFailures.current = 0;

    // Initial fetch
    fetchGraphData(connectionId).catch((e) => {
      console.error("[useSshGitPolling] Initial fetch failed:", e);
    });

    // ── Polling tick ──────────────────────────────────────────────
    let intervalId: ReturnType<typeof setInterval>;

    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await fetchGraphData(connectionId);
        consecutiveFailures.current = 0;
      } catch (e) {
        consecutiveFailures.current += 1;
        console.error("[useSshGitPolling] Tick failed:", e);
        if (consecutiveFailures.current >= MAX_CONSECUTIVE_FAILURES) {
          clearInterval(intervalId);
          console.warn(
            `[useSshGitPolling] Stopped polling after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`,
          );
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    // ── Interval management with wake recovery ───────────────────
    intervalId = setInterval(tick, intervalMs);
    let wakeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleWake = () => {
      console.info("[useSshGitPolling] Wake detected — resetting interval");
      clearInterval(intervalId);
      if (wakeTimeoutId !== null) clearTimeout(wakeTimeoutId);
      consecutiveFailures.current = 0;
      // Small delay lets the system stabilise before resuming SSH calls
      wakeTimeoutId = setTimeout(() => {
        wakeTimeoutId = null;
        intervalId = setInterval(tick, intervalMs);
        // Trigger one immediate refresh after wake
        tick().catch((e) => {
          console.error("[useSshGitPolling] Post-wake tick failed:", e);
        });
      }, 1500);
    };

    window.addEventListener("app:wake", handleWake);

    return () => {
      clearInterval(intervalId);
      if (wakeTimeoutId !== null) clearTimeout(wakeTimeoutId);
      window.removeEventListener("app:wake", handleWake);
    };
  }, [connectionId, isActive, intervalMs, fetchGraphData]);
}
