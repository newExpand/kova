import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  GitMerge,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  Bot,
  XCircle,
  FileWarning,
} from "lucide-react";
import { selectTmuxWindow } from "../../../lib/tauri/commands";
import { useGitStore } from "../stores/gitStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { useMergeStore } from "../stores/mergeStore";
import {
  useAgentActivityStore,
  normalizePathKey,
} from "../stores/agentActivityStore";

interface MergeProgressDialogProps {
  projectId: string;
}

export function MergeProgressDialog({
  projectId,
}: MergeProgressDialogProps) {
  const status = useMergeStore((s) => s.status);
  const context = useMergeStore((s) => s.context);
  const conflictDetails = useMergeStore((s) => s.conflictDetails);
  const result = useMergeStore((s) => s.result);
  const errorMessage = useMergeStore((s) => s.errorMessage);
  const dirtyFileCount = useMergeStore((s) => s.dirtyFileCount);
  const startMerge = useMergeStore((s) => s.startMerge);
  const sendConflictPromptToClaude = useMergeStore(
    (s) => s.sendConflictPromptToClaude,
  );
  const attemptCompletion = useMergeStore((s) => s.attemptCompletion);
  const abortMerge = useMergeStore((s) => s.abortMerge);
  const onAgentStopDetected = useMergeStore((s) => s.onAgentStopDetected);
  const dismiss = useMergeStore((s) => s.dismiss);
  const selectWorktree = useGitStore((s) => s.selectWorktree);
  const fetchWorkingChanges = useGitStore((s) => s.fetchWorkingChanges);
  const navigate = useNavigate();

  // Subscribe to agent Stop events for the merge worktree
  useEffect(() => {
    if (
      (status !== "waitingForClaude" && status !== "waitingForAgent") ||
      !context?.worktreePath
    ) {
      return;
    }

    const key = normalizePathKey(context.worktreePath);

    const unsub = useAgentActivityStore.subscribe((state) => {
      const session = state.sessions[key];
      if (session?.status === "done") {
        onAgentStopDetected();
      }
    });

    return unsub;
  }, [status, context?.worktreePath, onAgentStopDetected]);

  const handleViewChanges = useCallback(() => {
    if (!context?.worktreePath) return;
    dismiss();
    selectWorktree(context.worktreePath);
    fetchWorkingChanges(context.worktreePath);
  }, [context?.worktreePath, dismiss, selectWorktree, fetchWorkingChanges]);

  const handleOpenTerminal = useCallback(() => {
    dismiss();
    navigate(`/projects/${projectId}/terminal`);
    if (context?.agent) {
      selectTmuxWindow(context.agent.sessionName, context.agent.taskName).catch((e) => {
        console.warn("[MergeProgressDialog] Failed to select tmux window:", e);
      });
    }
  }, [dismiss, navigate, projectId, context?.agent]);

  const isOpen = status !== "idle";

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent className="max-w-md">
        {/* Confirming */}
        {status === "confirming" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <GitMerge className="h-4 w-4" />
                Merge to Main
              </DialogTitle>
              <DialogDescription>
                Branch{" "}
                <code className="rounded bg-white/[0.06] px-1 text-xs">
                  {context?.branchName}
                </code>{" "}
                will be rebased onto main and fast-forward merged. The worktree
                and branch will be deleted after merge.
              </DialogDescription>
            </DialogHeader>
            {(context?.dirtyCount ?? 0) > 0 && (
              <div className="flex items-center gap-2 rounded bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  This worktree has {context?.dirtyCount ?? 0} uncommitted change{(context?.dirtyCount ?? 0) !== 1 ? "s" : ""}.
                  Please commit or stash your changes first.
                </span>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={dismiss}>
                Cancel
              </Button>
              <Button size="sm" onClick={startMerge} disabled={(context?.dirtyCount ?? 0) > 0}>
                Merge
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Dirty worktree (backend blocked) */}
        {status === "dirty" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-warning">
                <FileWarning className="h-4 w-4" />
                Uncommitted Changes
              </DialogTitle>
              <DialogDescription>
                This worktree has{" "}
                <strong>{dirtyFileCount ?? "some"}</strong>{" "}
                uncommitted change{(dirtyFileCount ?? 0) !== 1 ? "s" : ""}.
                Please commit or stash your changes before merging to main.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={dismiss}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleViewChanges}>
                View Changes
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Rebasing / Completing */}
        {(status === "rebasing" || status === "completing") && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {status === "rebasing" ? "Rebasing..." : "Completing merge..."}
              </DialogTitle>
              <DialogDescription>
                {status === "rebasing"
                  ? "Rebasing onto main and checking for conflicts."
                  : "Performing fast-forward merge and cleaning up."}
              </DialogDescription>
            </DialogHeader>
          </>
        )}

        {/* Conflicts */}
        {status === "conflicts" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-warning">
                <AlertTriangle className="h-4 w-4" />
                Merge Conflicts
              </DialogTitle>
              <DialogDescription>
                Conflicts detected during rebase. Choose how to resolve:
              </DialogDescription>
            </DialogHeader>
            {conflictDetails && (
              <pre className="max-h-32 overflow-auto rounded bg-white/[0.04] p-2 text-[11px] text-text-muted">
                {conflictDetails}
              </pre>
            )}
            {errorMessage && (
              <p className="text-xs text-danger">{errorMessage}</p>
            )}
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={sendConflictPromptToClaude}
                  className="gap-1.5"
                >
                  <Bot className="h-3.5 w-3.5" />
                  Let Claude Resolve
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenTerminal}
                  className="gap-1.5"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  Open Terminal
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={attemptCompletion}>
                  Continue Merge
                </Button>
                <Button variant="ghost" size="sm" onClick={abortMerge} className="text-danger">
                  Abort
                </Button>
              </div>
            </DialogFooter>
          </>
        )}

        {/* Waiting for Agent (busy) */}
        {status === "waitingForAgent" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for Claude...
              </DialogTitle>
              <DialogDescription>
                Claude is currently busy. The conflict resolution prompt will be
                sent automatically when Claude finishes its current task.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleOpenTerminal}
                className="gap-1.5"
              >
                <Terminal className="h-3.5 w-3.5" />
                Open Terminal
              </Button>
              <Button variant="ghost" size="sm" onClick={abortMerge} className="text-danger">
                Abort
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Waiting for Claude (resolving) */}
        {status === "waitingForClaude" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bot className="h-4 w-4 animate-pulse" />
                Claude is resolving conflicts...
              </DialogTitle>
              <DialogDescription>
                Merge will complete automatically when Claude finishes.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleOpenTerminal}
                className="gap-1.5"
              >
                <Terminal className="h-3.5 w-3.5" />
                Open Terminal
              </Button>
              <Button variant="ghost" size="sm" onClick={abortMerge} className="text-danger">
                Abort
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Success */}
        {status === "success" && result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-success">
                <CheckCircle2 className="h-4 w-4" />
                Merge Complete
              </DialogTitle>
              <DialogDescription>
                Branch{" "}
                <code className="rounded bg-white/[0.06] px-1 text-xs">
                  {result.branchName}
                </code>{" "}
                merged at{" "}
                <code className="rounded bg-white/[0.06] px-1 text-xs">
                  {result.mergeHash}
                </code>
                .
                {result.worktreeRemoved && " Worktree removed."}
                {result.branchDeleted && " Branch deleted."}
              </DialogDescription>
            </DialogHeader>
            {!result.worktreeRemoved && (
              <div className="rounded bg-warning/10 px-3 py-2 text-xs text-warning">
                Could not automatically remove the worktree directory.
                Right-click the card and select Delete to remove it manually.
              </div>
            )}
            <DialogFooter>
              <Button size="sm" onClick={dismiss}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Error */}
        {status === "error" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-danger">
                <XCircle className="h-4 w-4" />
                Merge Failed
              </DialogTitle>
              <DialogDescription>{errorMessage}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={dismiss}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
