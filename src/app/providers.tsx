import { useEffect, type ReactNode } from "react";
import { initEventBridge, destroyEventBridge } from "../lib/event-bridge";

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

  return <>{children}</>;
}

export { AppProviders };
