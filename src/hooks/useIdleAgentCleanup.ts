import { useEffect } from "react";
import { useSettingsStore } from "../features/settings/stores/settingsStore";
import { useAgentActivityStore } from "../features/git/stores/agentActivityStore";
import { killIdleAgent } from "../lib/tauri/commands";

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const IDLE_STATUSES = new Set(["idle", "ready", "error"]);

/**
 * Periodically terminates idle agent processes (+ MCP servers) to reclaim memory.
 * Tmux panes are preserved — only processes are killed.
 */
export function useIdleAgentCleanup(): void {
  // Individual primitive selectors — avoids Zustand infinite-render from object selectors
  const enabled = useSettingsStore((s) => s.idleCleanupEnabled);
  const hours = useSettingsStore((s) => s.idleCleanupHours);

  useEffect(() => {
    if (!enabled) return;

    const thresholdMs = hours * 60 * 60 * 1000;

    async function checkAndCleanup() {
      const sessions = useAgentActivityStore.getState().sessions;
      const now = Date.now();

      for (const [sessionKey, session] of Object.entries(sessions)) {
        if (!IDLE_STATUSES.has(session.status)) continue;
        if (session.isWaitingForInput) continue;
        if (!session.paneId) continue;
        if (!session.lastActivity) continue;

        const idleMs = now - new Date(session.lastActivity).getTime();
        if (idleMs < thresholdMs) continue;

        const idleHours = (idleMs / (1000 * 60 * 60)).toFixed(1);

        try {
          const pid = await killIdleAgent(session.paneId);
          if (pid != null) {
            // Phase 1: SIGTERM sent. Let the agent's natural death trigger
            // cleanup via hook Stop event or pane_monitor synthetic Stop.
            // If the hook doesn't fire, the next cycle handles it (Phase 2).
            console.info(
              "[idle-cleanup] sent SIGTERM to agent in pane %s (PID %d, %sh idle)",
              session.paneId,
              pid,
              idleHours,
            );
          } else {
            // Phase 2: Agent already dead (no process in pane) but session
            // still in store — hook-based agents (Claude/Gemini) may not send
            // Stop on external SIGTERM. Clear the ghost session.
            useAgentActivityStore.getState().clearSession(sessionKey);
            console.info(
              "[idle-cleanup] cleared ghost session %s (pane %s, agent already exited)",
              sessionKey,
              session.paneId,
            );
          }
        } catch (e) {
          console.warn("[idle-cleanup] failed to kill agent in pane %s:", session.paneId, e);
        }
      }
    }

    const id = setInterval(() => void checkAndCleanup(), CLEANUP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, hours]);
}
