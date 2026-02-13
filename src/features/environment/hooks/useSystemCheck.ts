import { useEffect, useState } from "react";
import { checkEnvironment } from "../../../lib/tauri/commands";
import type { EnvironmentCheck } from "../types";

export function useSystemCheck() {
  const [env, setEnv] = useState<EnvironmentCheck | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    checkEnvironment()
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
