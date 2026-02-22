import { useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { X, AlertCircle, FolderGit2, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { useGitStore } from "../stores/gitStore";
import { DiffFileList } from "./DiffViewer";
import { CommitBox } from "./CommitBox";

interface WorkingChangesPanelProps {
  onClose: () => void;
  maximized: boolean;
  onToggleMaximize: () => void;
  projectId: string;
  projectPath: string;
  sessionName: string | null;
}

export function WorkingChangesPanel({ onClose, maximized, onToggleMaximize, projectId, projectPath, sessionName }: WorkingChangesPanelProps) {
  const selectedWorktreePath = useGitStore((s) => s.selectedWorktreePath);
  const workingChanges = useGitStore((s) => s.workingChanges);
  const isLoading = useGitStore((s) => s.isWorkingChangesLoading);
  const error = useGitStore((s) => s.workingChangesError);
  const fetchWorkingChanges = useGitStore((s) => s.fetchWorkingChanges);
  const stageFiles = useGitStore((s) => s.stageFiles);
  const unstageFiles = useGitStore((s) => s.unstageFiles);
  const unstageAll = useGitStore((s) => s.unstageAll);
  const discardFile = useGitStore((s) => s.discardFile);
  const isCommitting = useGitStore((s) => s.isCommitting);
  const isStagingInProgress = useGitStore((s) => s.isStagingInProgress);

  // Fetch when selected worktree changes
  useEffect(() => {
    if (selectedWorktreePath) {
      fetchWorkingChanges(selectedWorktreePath);
    }
  }, [selectedWorktreePath, fetchWorkingChanges]);

  // Escape key closes the panel (skip if dialog/modal is open)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        const activeEl = document.activeElement;
        if (activeEl?.closest("[role='dialog']")) return;
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Staging callbacks
  const handleStageFile = useCallback((path: string) => {
    if (selectedWorktreePath) stageFiles(selectedWorktreePath, [path]);
  }, [selectedWorktreePath, stageFiles]);

  const handleUnstageFile = useCallback((path: string) => {
    if (selectedWorktreePath) unstageFiles(selectedWorktreePath, [path]);
  }, [selectedWorktreePath, unstageFiles]);

  const handleDiscardFile = useCallback((path: string, isUntracked: boolean) => {
    if (selectedWorktreePath) discardFile(selectedWorktreePath, path, isUntracked);
  }, [selectedWorktreePath, discardFile]);

  const stageAllFromSection = useCallback((section: "unstaged" | "untracked") => {
    if (!selectedWorktreePath || !workingChanges) return;
    const paths = workingChanges[section].map((f) => f.path);
    if (paths.length > 0) stageFiles(selectedWorktreePath, paths);
  }, [selectedWorktreePath, workingChanges, stageFiles]);

  const handleStageAllUnstaged = useCallback(() => stageAllFromSection("unstaged"), [stageAllFromSection]);
  const handleStageAllUntracked = useCallback(() => stageAllFromSection("untracked"), [stageAllFromSection]);

  const handleUnstageAll = useCallback(() => {
    if (selectedWorktreePath) unstageAll(selectedWorktreePath);
  }, [selectedWorktreePath, unstageAll]);

  if (!selectedWorktreePath) return null;

  // Short label from path (last 2 segments)
  const shortPath = selectedWorktreePath.split("/").slice(-2).join("/");
  const stagedCount = workingChanges?.staged.length ?? 0;
  const totalChanges = (workingChanges?.unstaged.length ?? 0) + (workingChanges?.untracked.length ?? 0);
  const isOperationInProgress = isCommitting || isStagingInProgress;

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={`border-t border-white/[0.06] bg-white/[0.02] flex flex-col overflow-hidden ${
        maximized ? "flex-1" : "min-h-[50vh] max-h-[50vh]"
      }`}
    >
      {/* Header */}
      <div
        className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-white/[0.03] border-b border-white/[0.04] cursor-pointer select-none"
        onDoubleClick={onToggleMaximize}
      >
        <FolderGit2 className="h-3.5 w-3.5 text-text-muted" />
        <span className="text-sm font-medium text-text-secondary">
          Working Changes
        </span>
        <span className="text-[11px] text-text-muted font-mono truncate">
          {shortPath}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => selectedWorktreePath && fetchWorkingChanges(selectedWorktreePath)}
          disabled={isLoading}
          className="rounded p-1 text-text-muted hover:bg-white/[0.08] hover:text-text-secondary transition-colors disabled:opacity-30"
          aria-label="Refresh changes"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>
        <button
          type="button"
          onClick={onToggleMaximize}
          className="rounded p-1 text-text-muted hover:bg-white/[0.08] hover:text-text-secondary transition-colors"
          aria-label={maximized ? "Restore panel" : "Maximize panel"}
        >
          {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-text-muted hover:bg-white/[0.08] hover:text-text-secondary transition-colors"
          aria-label="Close working changes"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-primary" />
            <span className="ml-2 text-sm text-text-muted">Loading changes...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 py-8">
            <AlertCircle className="h-4 w-4 text-red-400" />
            <span className="text-sm text-red-400">{error || "An unknown error occurred"}</span>
          </div>
        ) : workingChanges ? (
          workingChanges.stats.filesChanged === 0 ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-sm text-text-muted">No uncommitted changes</span>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Commit box */}
              <CommitBox
                worktreePath={selectedWorktreePath}
                projectId={projectId}
                projectPath={projectPath}
                stagedCount={stagedCount}
                totalChanges={totalChanges}
                sessionName={sessionName}
              />

              {/* Stats summary */}
              <div className="text-sm text-text-muted">
                {workingChanges.stats.filesChanged} files changed,{" "}
                <span className="text-green-400">+{workingChanges.stats.insertions}</span>
                {" insertions, "}
                <span className="text-red-400">-{workingChanges.stats.deletions}</span>
                {" deletions"}
              </div>

              {/* Staged section — no discard (git restore without --staged has no effect on staged files) */}
              <DiffFileList
                files={workingChanges.staged}
                sectionLabel="Staged"
                defaultExpanded={true}
                onUnstageFile={handleUnstageFile}
                bulkAction={{ onAction: handleUnstageAll, label: "Unstage All" }}
                disabled={isOperationInProgress}
              />

              {/* Unstaged section */}
              <DiffFileList
                files={workingChanges.unstaged}
                sectionLabel="Unstaged"
                defaultExpanded={true}
                onStageFile={handleStageFile}
                onDiscardFile={handleDiscardFile}
                bulkAction={{ onAction: handleStageAllUnstaged, label: "Stage All" }}
                disabled={isOperationInProgress}
              />

              {/* Untracked section */}
              <DiffFileList
                files={workingChanges.untracked}
                sectionLabel="Untracked"
                defaultExpanded={false}
                onStageFile={handleStageFile}
                onDiscardFile={handleDiscardFile}
                bulkAction={{ onAction: handleStageAllUntracked, label: "Stage All" }}
                disabled={isOperationInProgress}
              />
            </div>
          )
        ) : (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-text-muted">No data available</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
