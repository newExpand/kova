import { useEffect, useRef } from "react";
import { useSshGitStore } from "../stores/sshGitStore";

/**
 * Polls SSH remote git data at an interval when the SSH git tab is active.
 *
 * Simplified version of useGitPolling:
 * - No fingerprint-based smart refresh (no cheap remote status check)
 * - No git fetch (read-only view of remote repo)
 * - 30-second default interval (SSH calls are heavier than local git)
 * - `inFlightRef` prevents overlapping SSH calls
 * - Listens for `app:wake` event for sleep/wake recovery
 */
export function useSshGitPolling(
  connectionId: string,
  isActive: boolean,
  intervalMs: number = 30000,
): void {
  const fetchGraphData = useSshGitStore((s) => s.fetchGraphData);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!isActive || !connectionId) return;

    // Initial fetch
    fetchGraphData(connectionId).catch((e) => {
      console.error("[useSshGitPolling] Initial fetch failed:", e);
    });

    // ── Polling tick ──────────────────────────────────────────────
    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await fetchGraphData(connectionId);
      } catch (e) {
        console.error("[useSshGitPolling] Tick failed:", e);
      } finally {
        inFlightRef.current = false;
      }
    };

    // ── Interval management with wake recovery ───────────────────
    let intervalId = setInterval(tick, intervalMs);
    let wakeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleWake = () => {
      console.info("[useSshGitPolling] Wake detected — resetting interval");
      clearInterval(intervalId);
      if (wakeTimeoutId !== null) clearTimeout(wakeTimeoutId);
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
