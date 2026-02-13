import { useEffect } from "react";
import { useTmuxStore } from "../stores/tmuxStore";

export function useTmuxSessions() {
  const checkAvailability = useTmuxStore((s) => s.checkAvailability);
  const fetchSessions = useTmuxStore((s) => s.fetchSessions);
  const isAvailable = useTmuxStore((s) => s.isAvailable);
  const sessions = useTmuxStore((s) => s.sessions);
  const isLoading = useTmuxStore((s) => s.isLoading);
  const error = useTmuxStore((s) => s.error);

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

  return { sessions, isAvailable, isLoading, error };
}
