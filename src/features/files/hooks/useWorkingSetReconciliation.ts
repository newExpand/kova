import { useEffect } from "react";
import { useAgentFileTrackingStore } from "../stores/agentFileTrackingStore";
import { normalizePathKey } from "../../git";

const RECONCILE_INTERVAL_MS = 15_000;

/**
 * Global reconciliation hook — keeps the Working Set in sync with git status
 * regardless of which tab is active. Only polls when tracked files exist.
 */
export function useWorkingSetReconciliation(
  projectPath: string | null,
): void {
  const hasTrackedFiles = useAgentFileTrackingStore((s) => {
    if (!projectPath) return false;
    const key = normalizePathKey(projectPath);
    const ws = s.workingSets[key];
    if (!ws) return false;
    return Object.keys(ws.writes).length > 0 || Object.keys(ws.userEdits).length > 0;
  });

  useEffect(() => {
    if (!projectPath || !hasTrackedFiles) return;

    const reconcile = () =>
      useAgentFileTrackingStore
        .getState()
        .reconcileNow(projectPath)
        .catch((err: unknown) =>
          console.error("[useWorkingSetReconciliation] reconcile failed:", err),
        );

    reconcile();
    const id = setInterval(reconcile, RECONCILE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [projectPath, hasTrackedFiles]);
}
