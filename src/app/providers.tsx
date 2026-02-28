import { useEffect, type ReactNode } from "react";
import { initEventBridge, destroyEventBridge } from "../lib/event-bridge";
import { useSleepWakeDetector } from "../hooks/useSleepWakeDetector";

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

  return <>{children}</>;
}

export { AppProviders };
