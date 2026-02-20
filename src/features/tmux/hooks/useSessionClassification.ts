import { useMemo } from "react";
import { useTerminalStore } from "../../terminal";
import type { SessionInfo } from "../types";

/**
 * Classify tmux sessions as "app" vs "external" based on whether they have
 * an active PTY connection from this app (connected or connecting).
 */
export function useSessionClassification(sessions: SessionInfo[]) {
  const terminals = useTerminalStore((s) => s.terminals);

  const activeSessionNames = useMemo(() => {
    const names = new Set<string>();
    for (const term of Object.values(terminals)) {
      if (term.sessionName && (term.status === "connected" || term.status === "connecting")) {
        names.add(term.sessionName);
      }
    }
    return names;
  }, [terminals]);

  const appSessions = useMemo(
    () => sessions.filter((s) => activeSessionNames.has(s.name)),
    [sessions, activeSessionNames],
  );
  const externalSessions = useMemo(
    () => sessions.filter((s) => !activeSessionNames.has(s.name)),
    [sessions, activeSessionNames],
  );

  return { appSessions, externalSessions };
}
