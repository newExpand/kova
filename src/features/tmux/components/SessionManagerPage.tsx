import { useEffect, useState, useCallback } from "react";
import { Monitor, RefreshCw, Trash2, X } from "lucide-react";
import { useTmuxStore } from "../stores/tmuxStore";
import { useProjectStore } from "../../project";
import { useTerminalStore } from "../../terminal";
import { useSessionClassification } from "../hooks/useSessionClassification";
import { killTmuxSession } from "../../../lib/tauri/commands";
import type { SessionInfo } from "../types";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "../../../components/ui/dialog";
import { cn } from "../../../lib/utils";

// ---------------------------------------------------------------------------
// Session Card
// ---------------------------------------------------------------------------

interface SessionCardProps {
  session: SessionInfo;
  projectName: string | null;
  onKill: (session: SessionInfo) => void;
}

function SessionCard({ session, projectName, onKill }: SessionCardProps) {
  return (
    <div className="flex items-start justify-between rounded-xl border border-white/[0.10] glass-surface glass-hover-lift p-4">
      <div className="flex items-start gap-3 min-w-0">
        <span
          className={cn(
            "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
            session.attached ? "bg-success" : "bg-text-muted",
          )}
          title={session.attached ? "Attached" : "Detached"}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text">
            {session.name}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            {session.windows} {session.windows === 1 ? "window" : "windows"}
            {" \u00b7 "}
            {session.attached ? "attached" : "detached"}
            {projectName && (
              <>
                {" \u00b7 "}
                <span className="text-text-secondary">{projectName}</span>
              </>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Created: {session.created}
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-text-muted hover:text-danger"
        onClick={() => onKill(session)}
        aria-label={`Kill session ${session.name}`}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session Group
// ---------------------------------------------------------------------------

interface SessionGroupProps {
  title: string;
  sessions: SessionInfo[];
  getProjectName: (id: string | null) => string | null;
  onKill: (session: SessionInfo) => void;
}

function SessionGroup({ title, sessions, getProjectName, onKill }: SessionGroupProps) {
  if (sessions.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </h3>
      <div className="space-y-2">
        {sessions.map((s) => (
          <SessionCard
            key={s.name}
            session={s}
            projectName={getProjectName(s.projectId)}
            onKill={onKill}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-6 animate-in fade-in duration-500">
        <div className="relative flex items-center justify-center">
          <div className="absolute h-24 w-24 rounded-2xl bg-primary/[0.06]" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-2xl glass-surface border border-white/[0.08]">
            <Monitor className="h-10 w-10 text-text-muted" strokeWidth={1.5} />
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-base font-medium text-text-secondary">
            No tmux sessions
          </h2>
          <p className="text-sm text-text-muted">
            Start a project to create a terminal session
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionManagerPage
// ---------------------------------------------------------------------------

function SessionManagerPage() {
  const sessions = useTmuxStore((s) => s.sessions);
  const isLoading = useTmuxStore((s) => s.isLoading);
  const fetchSessions = useTmuxStore((s) => s.fetchSessions);
  const getProjectById = useProjectStore((s) => s.getProjectById);

  const [killTarget, setKillTarget] = useState<SessionInfo | null>(null);
  const [isKilling, setIsKilling] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);
  const [showKillAllDialog, setShowKillAllDialog] = useState(false);
  const [isKillingAll, setIsKillingAll] = useState(false);
  const [killAllError, setKillAllError] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const { appSessions, externalSessions } = useSessionClassification(sessions);

  const getProjectName = useCallback(
    (projectId: string | null): string | null => {
      if (!projectId) return null;
      return getProjectById(projectId)?.name ?? null;
    },
    [getProjectById],
  );

  const handleKillAllConfirm = async () => {
    setIsKillingAll(true);
    setKillAllError(null);
    try {
      // Set error state on matching terminals FIRST to prevent auto-reconnect
      for (const session of appSessions) {
        if (session.projectId) {
          useTerminalStore.getState().setError(session.projectId, "Session was terminated.");
        }
      }
      // Kill each session individually
      const failed: string[] = [];
      for (const session of appSessions) {
        try {
          await killTmuxSession(session.name);
        } catch (err) {
          console.error(`[Kill All] Failed to kill session '${session.name}':`, err);
          failed.push(session.name);
          // Revert error state for failed kills — session is still alive
          if (session.projectId) {
            useTerminalStore.getState().setStatus(session.projectId, "disconnected");
          }
        }
      }
      try {
        await fetchSessions();
      } catch (err) {
        console.error("[Kill All] Failed to refresh session list:", err);
      }
      if (failed.length > 0) {
        setKillAllError(
          `${appSessions.length - failed.length}개 종료됨, ${failed.length}개 실패: ${failed.join(", ")}`,
        );
        return;
      }
      setShowKillAllDialog(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setKillAllError(`세션 종료 중 오류: ${message}`);
    } finally {
      setIsKillingAll(false);
    }
  };

  const handleKillConfirm = async () => {
    if (!killTarget) return;
    setIsKilling(true);
    setKillError(null);
    try {
      await killTmuxSession(killTarget.name);
      await fetchSessions();
      setKillTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setKillError(`'${killTarget.name}' 종료 실패: ${message}`);
    } finally {
      setIsKilling(false);
    }
  };

  if (!isLoading && sessions.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-text">Sessions</h1>
          <p className="text-xs text-text-muted">
            {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {appSessions.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowKillAllDialog(true)}
              disabled={isLoading || isKillingAll}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Kill All
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchSessions()}
            disabled={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <SessionGroup
          title="App-Managed Sessions"
          sessions={appSessions}
          getProjectName={getProjectName}
          onKill={setKillTarget}
        />
        <SessionGroup
          title="External Sessions"
          sessions={externalSessions}
          getProjectName={getProjectName}
          onKill={setKillTarget}
        />
      </div>

      {/* Kill confirmation dialog */}
      <Dialog
        open={!!killTarget}
        onOpenChange={(open) => {
          if (!open) {
            setKillTarget(null);
            setKillError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kill Session</DialogTitle>
            <DialogDescription>
              {`'${killTarget?.name ?? ""}' `}
              세션을 종료하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          {killError && (
            <p className="text-sm text-danger">{killError}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setKillTarget(null);
                setKillError(null);
              }}
              disabled={isKilling}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleKillConfirm}
              disabled={isKilling}
            >
              {isKilling ? "종료 중..." : "종료"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Kill All confirmation dialog */}
      <Dialog
        open={showKillAllDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowKillAllDialog(false);
            setKillAllError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kill All App Sessions</DialogTitle>
            <DialogDescription>
              {appSessions.length}개의 앱 관리 세션을 모두 종료하시겠습니까? 외부 세션은 영향받지 않습니다.
            </DialogDescription>
          </DialogHeader>
          {killAllError && (
            <p className="text-sm text-danger">{killAllError}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowKillAllDialog(false);
                setKillAllError(null);
              }}
              disabled={isKillingAll}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleKillAllConfirm}
              disabled={isKillingAll}
            >
              {isKillingAll ? "종료 중..." : `${appSessions.length}개 세션 종료`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SessionManagerPage;
export { SessionManagerPage };
