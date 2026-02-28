import { useEffect } from "react";

const INTERVAL_MS = 5000;
const THRESHOLD_MS = 15000; // 15s drift → sleep detected

/**
 * Detects macOS sleep/wake cycles by monitoring setInterval drift.
 *
 * When the system sleeps, JS timers pause. On wake, the actual elapsed time
 * far exceeds the expected interval — this drift signals a sleep/wake cycle.
 *
 * Dispatches `app:wake` CustomEvent on window when wake is detected.
 * Consumers (useGitPolling, useTerminal, etc.) listen for this event
 * to reset intervals, test connections, or trigger recovery logic.
 *
 * Why not `visibilitychange`? — Tauri WKWebView only fires it on
 * minimize/maximize, not on focus loss or sleep/wake (tauri-apps/tauri#9524).
 */
export function useSleepWakeDetector(): void {
  useEffect(() => {
    let lastTick = Date.now();

    const id = setInterval(() => {
      const now = Date.now();
      const drift = now - lastTick - INTERVAL_MS;
      lastTick = now;

      if (drift > THRESHOLD_MS) {
        const sleepSec = Math.round(drift / 1000);
        console.info(`[wake] Sleep detected: drift=${sleepSec}s, dispatching app:wake`);
        window.dispatchEvent(
          new CustomEvent("app:wake", { detail: { sleepDuration: drift } }),
        );
      }
    }, INTERVAL_MS);

    return () => clearInterval(id);
  }, []);
}
