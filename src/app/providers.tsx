import { useEffect, type ReactNode } from "react";
import { initEventBridge, destroyEventBridge } from "../lib/event-bridge";
import { useSleepWakeDetector } from "../hooks/useSleepWakeDetector";
import { useIdleAgentCleanup } from "../hooks/useIdleAgentCleanup";

interface AppProvidersProps {
  children: ReactNode;
}

function AppProviders({ children }: AppProvidersProps) {
  useEffect(() => {
    initEventBridge();
    return () => {
      destroyEventBridge();
    };
  }, []);

  // Detect macOS sleep/wake cycles via timestamp drift.
  // Dispatches "app:wake" events consumed by useGitPolling and useTerminal.
  useSleepWakeDetector();

  // Periodically terminate idle agents to reclaim memory (~190MB per agent).
  useIdleAgentCleanup();

  return <>{children}</>;
}

export { AppProviders };
