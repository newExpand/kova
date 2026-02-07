import { cn } from "@/lib/utils";
import { useSystemCheck } from "../hooks/useSystemCheck";
import type { DependencyStatus } from "../types";

interface DependencyItemProps {
  label: string;
  status: DependencyStatus;
  isLoading: boolean;
}

function DependencyItem({ label, status, isLoading }: DependencyItemProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-lg border px-4 py-3",
        "bg-[var(--surface-1)] border-[var(--border)]",
      )}
    >
      <div className="flex items-center gap-3">
        {isLoading ? (
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent text-[var(--text-muted)]" />
        ) : status.installed ? (
          <span className="text-[var(--status-success)] text-lg">&#x2705;</span>
        ) : (
          <span className="text-[var(--status-error)] text-lg">&#x274C;</span>
        )}
        <div>
          <p className="font-medium text-[var(--text-primary)]">{label}</p>
          <p className="text-sm text-[var(--text-muted)]">
            {status.version ? status.version : status.message}
          </p>
        </div>
      </div>
      {!isLoading && !status.installed && status.installHint && (
        <code className="rounded bg-[var(--surface-2)] px-2 py-1 font-mono text-xs text-[var(--text-secondary)]">
          {status.installHint}
        </code>
      )}
    </div>
  );
}

interface EnvironmentCheckProps {
  onComplete: () => void;
}

export function EnvironmentCheck({ onComplete }: EnvironmentCheckProps) {
  const { status, isLoading, error, recheck } = useSystemCheck();

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-8 px-4 py-16">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          환경 설정 확인
        </h1>
        <p className="mt-2 text-[var(--text-muted)]">
          flow-orche에 필요한 의존성을 확인합니다
        </p>
      </div>

      {error && (
        <div className="w-full rounded-lg border border-[var(--status-error)] bg-[var(--status-error)]/10 px-4 py-3 text-sm text-[var(--status-error)]">
          {error}
        </div>
      )}

      <div className="flex w-full flex-col gap-3">
        {status ? (
          <>
            <DependencyItem
              label="Claude Code CLI"
              status={status.claudeCli}
              isLoading={isLoading}
            />
            <DependencyItem
              label="tmux"
              status={status.tmux}
              isLoading={isLoading}
            />
            <DependencyItem
              label="Claude 인증"
              status={status.claudeAuth}
              isLoading={isLoading}
            />
          </>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent text-[var(--text-muted)]" />
            <span className="ml-3 text-[var(--text-muted)]">확인 중...</span>
          </div>
        ) : null}
      </div>

      <div className="flex gap-3">
        {status && !status.allReady && (
          <button
            type="button"
            onClick={recheck}
            disabled={isLoading}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              "bg-[var(--surface-2)] text-[var(--text-primary)] hover:bg-[var(--surface-3)]",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isLoading ? "확인 중..." : "재확인"}
          </button>
        )}
        {status?.allReady && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-[var(--status-success)] font-medium">
              환경 준비 완료
            </p>
            <button
              type="button"
              onClick={onComplete}
              className={cn(
                "rounded-lg px-6 py-2.5 text-sm font-medium transition-colors",
                "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/90",
              )}
            >
              프로젝트 등록하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
