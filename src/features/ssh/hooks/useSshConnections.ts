import { useEffect } from "react";
import { useSshStore } from "../stores/sshStore";

/** Fetch all SSH connections on mount */
export function useSshConnections() {
  const fetchConnections = useSshStore((s) => s.fetchConnections);
  const connections = useSshStore((s) => s.connections);
  const isLoading = useSshStore((s) => s.isLoading);
  const error = useSshStore((s) => s.error);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  return { connections, isLoading, error };
}

/** Fetch SSH connections for a specific project on mount */
export function useSshConnectionsByProject(projectId: string | null) {
  const fetchConnectionsByProject = useSshStore(
    (s) => s.fetchConnectionsByProject,
  );
  const getConnectionsByProject = useSshStore(
    (s) => s.getConnectionsByProject,
  );
  const isLoading = useSshStore((s) => s.isLoading);

  useEffect(() => {
    if (projectId) {
      fetchConnectionsByProject(projectId);
    }
  }, [projectId, fetchConnectionsByProject]);

  const error = useSshStore((s) => s.error);
  const connections = projectId ? getConnectionsByProject(projectId) : [];
  return { connections, isLoading, error };
}
