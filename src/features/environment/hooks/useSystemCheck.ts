import { useEffect, useState } from "react";
import { checkEnvironment } from "../../../lib/tauri/commands";
import type { EnvironmentCheck } from "../types";

// ---------------------------------------------------------------------------
// Module-level Promise cache — checkEnvironment() spawns 5 sub-processes
// sequentially (~500ms+). This ensures only 1 IPC call per app session,
// shared across all consumers (useSystemCheck, settingsStore, etc.).
// ---------------------------------------------------------------------------
let cachedPromise: Promise<EnvironmentCheck> | null = null;

export function getCachedEnvironment(): Promise<EnvironmentCheck> {
  if (!cachedPromise) {
    cachedPromise = checkEnvironment();
  }
  return cachedPromise;
}

export function useSystemCheck() {
  const [env, setEnv] = useState<EnvironmentCheck | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getCachedEnvironment()
      .then((result) => {
        if (!cancelled) {
          setEnv(result);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { env, isLoading, error };
}
