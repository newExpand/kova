import { useCallback, useEffect, useState } from "react";
import { checkEnvironment, recheckEnvironment } from "@/lib/tauri/commands";
import type { EnvironmentStatus } from "../types";

interface UseSystemCheckReturn {
  status: EnvironmentStatus | null;
  isLoading: boolean;
  error: string | null;
  recheck: () => Promise<void>;
}

export function useSystemCheck(): UseSystemCheckReturn {
  const [status, setStatus] = useState<EnvironmentStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async (isRecheck = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = isRecheck
        ? await recheckEnvironment()
        : await checkEnvironment();
      setStatus(result);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : typeof e === "object" && e !== null && "message" in e
              ? String((e as Record<string, unknown>).message)
              : "환경 감지에 실패했습니다";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    runCheck(false);
  }, [runCheck]);

  const recheck = useCallback(() => runCheck(true), [runCheck]);

  return { status, isLoading, error, recheck };
}
