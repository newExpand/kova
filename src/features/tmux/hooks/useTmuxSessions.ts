import { useMemo, useEffect } from "react";
import { useTmuxStore } from "../stores/tmuxStore";

export function useTmuxSessions(projectId?: string) {
  const checkAvailability = useTmuxStore((s) => s.checkAvailability);
  const fetchSessions = useTmuxStore((s) => s.fetchSessions);
  const isAvailable = useTmuxStore((s) => s.isAvailable);
  const sessions = useTmuxStore((s) => s.sessions);
  const isLoading = useTmuxStore((s) => s.isLoading);
  const error = useTmuxStore((s) => s.error);
  const hasFetchedSessions = useTmuxStore((s) => s.hasFetchedSessions);

  useEffect(() => {
    if (isAvailable === null) {
      checkAvailability();
    }
  }, [isAvailable, checkAvailability]);

  useEffect(() => {
    if (isAvailable === true) {
      fetchSessions();
    }
  }, [isAvailable, fetchSessions]);

  const projectSessions = useMemo(() => {
    if (!projectId) return [];
    return sessions.filter((s) => s.isAppSession && s.projectId === projectId);
  }, [sessions, projectId]);

  return {
    sessions,
    projectSessions,
    isAvailable,
    isLoading,
    hasFetchedSessions,
    error,
  };
}
