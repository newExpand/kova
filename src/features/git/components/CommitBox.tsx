import { useCallback, useEffect, useState, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Terminal as TerminalIcon, Check, ArrowUpCircle } from "lucide-react";
import { useGitStore } from "../stores/gitStore";

const InlineTerminal = lazy(() =>
  import("./InlineTerminal").then((m) => ({ default: m.InlineTerminal }))
);

interface CommitBoxProps {
  worktreePath: string;
  projectId: string;
  projectPath: string;
  stagedCount: number;
  totalChanges: number;
  sessionName: string | null;
}

export function CommitBox({ worktreePath, projectId, projectPath, stagedCount, totalChanges, sessionName }: CommitBoxProps) {
  const commitMessage = useGitStore((s) => s.commitMessage);
  const isCommitting = useGitStore((s) => s.isCommitting);
  const isStagingInProgress = useGitStore((s) => s.isStagingInProgress);
  const commitError = useGitStore((s) => s.commitError);
  const lastCommitHash = useGitStore((s) => s.lastCommitHash);
  const setCommitMessage = useGitStore((s) => s.setCommitMessage);
  const commitChanges = useGitStore((s) => s.commitChanges);
  const stageAll = useGitStore((s) => s.stageAll);

  const [showBody, setShowBody] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);

  // Parse subject/body from combined message
  const parts = commitMessage.split("\n\n");
  const subject = parts[0] || "";
  const body = parts.slice(1).join("\n\n");

  const updateMessage = useCallback((newSubject: string, newBody: string) => {
    const combined = newBody.trim()
      ? `${newSubject}\n\n${newBody}`
      : newSubject;
    setCommitMessage(combined);
  }, [setCommitMessage]);

  const canCommit = subject.trim().length > 0 && stagedCount > 0 && !isCommitting;

  const handleCommit = useCallback(() => {
    if (!canCommit) return;
    commitChanges(worktreePath, commitMessage, projectId, projectPath);
  }, [canCommit, commitChanges, worktreePath, commitMessage, projectId, projectPath]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey && canCommit) {
      e.preventDefault();
      handleCommit();
    }
  }, [canCommit, handleCommit]);

  const handleStageAll = useCallback(() => {
    stageAll(worktreePath);
  }, [stageAll, worktreePath]);

  // Auto-hide success hash after 3 seconds
  const [showSuccess, setShowSuccess] = useState(false);
  useEffect(() => {
    if (lastCommitHash) {
      setShowSuccess(true);
      const timer = setTimeout(() => setShowSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [lastCommitHash]);

  useEffect(() => {
    if (body.trim()) setShowBody(true);
  }, [body]);

  // Collapse body when focus leaves the CommitBox and body is empty
  const handleBoxBlur = useCallback((e: React.FocusEvent) => {
    const commitBox = e.currentTarget;
    if (!commitBox.contains(e.relatedTarget as Node) && !body.trim()) {
      setShowBody(false);
    }
  }, [body]);

  // ── Inline terminal mode ──
  if (showTerminal && sessionName) {
    return (
      <Suspense fallback={
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 flex items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-primary" />
          <span className="ml-2 text-xs text-text-muted">Loading terminal...</span>
        </div>
      }>
        <InlineTerminal
          sessionName={sessionName}
          onClose={() => setShowTerminal(false)}
        />
      </Suspense>
    );
  }

  // ── Empty state: no staged files ──
  if (stagedCount === 0) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
        <div className="flex items-center gap-2 text-text-muted">
          <ArrowUpCircle className="h-4 w-4 shrink-0" />
          <span className="text-sm">Stage files to commit</span>
        </div>
        <p className="text-xs text-text-muted/70 pl-6">
          Use <span className="font-mono text-text-muted bg-white/[0.04] px-1 rounded">+</span> buttons on each file, or:
        </p>
        <div className="pl-6 flex items-center gap-2">
          <button
            type="button"
            onClick={handleStageAll}
            disabled={totalChanges === 0 || isStagingInProgress}
            className="px-3 py-1 rounded text-xs font-medium bg-primary/90 text-white hover:bg-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isStagingInProgress ? "Staging..." : `Stage All Changes (${totalChanges})`}
          </button>
        </div>
        {commitError && (
          <p className="text-xs text-red-400 pl-6" title={commitError}>{commitError}</p>
        )}
        <AnimatePresence>
          {showSuccess && lastCommitHash && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center gap-1 text-xs text-green-400 pl-6">
              <Check className="h-3 w-3" />
              <span className="font-mono">{lastCommitHash}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Normal state: has staged files ──
  return (
    <div
      className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 space-y-1.5"
      onBlur={handleBoxBlur}
    >
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={subject}
          onChange={(e) => updateMessage(e.target.value, body)}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowBody(true)}
          maxLength={72}
          placeholder="Commit message (required)"
          disabled={isCommitting}
          className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1 text-sm text-text-secondary placeholder:text-text-muted/50 focus:outline-none focus:border-primary/40 disabled:opacity-50 font-mono"
        />
        <button
          type="button"
          onClick={() => setShowTerminal(true)}
          disabled={!sessionName || isCommitting}
          className="shrink-0 rounded p-1.5 text-text-muted hover:text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-30"
          aria-label="Open inline terminal"
          title="Open terminal"
        >
          <TerminalIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <AnimatePresence>
        {showBody && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <textarea
              value={body}
              onChange={(e) => updateMessage(subject, e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder="Extended description (optional)"
              disabled={isCommitting}
              className="w-full bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1 text-sm text-text-secondary placeholder:text-text-muted/50 focus:outline-none focus:border-primary/40 disabled:opacity-50 font-mono resize-none"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleCommit}
          disabled={!canCommit}
          className="px-3 py-1 rounded text-xs font-medium bg-primary/90 text-white hover:bg-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={canCommit ? "Commit (Cmd+Enter)" : undefined}
        >
          {isCommitting ? "Committing..." : `Commit (${stagedCount} staged)`}
        </button>
        <AnimatePresence>
          {showSuccess && lastCommitHash && (
            <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-1 text-xs text-green-400">
              <Check className="h-3 w-3" />
              <span className="font-mono">{lastCommitHash}</span>
            </motion.span>
          )}
        </AnimatePresence>
        {commitError && (
          <span className="text-xs text-red-400" title={commitError}>{commitError}</span>
        )}
        <span className="ml-auto text-[10px] text-text-muted tabular-nums">
          {subject.length}/72
        </span>
      </div>
    </div>
  );
}
