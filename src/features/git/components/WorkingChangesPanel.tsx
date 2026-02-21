import { useEffect } from "react";
import { motion } from "motion/react";
import { X, AlertCircle, FolderGit2 } from "lucide-react";
import { useGitStore } from "../stores/gitStore";
import { DiffFileList } from "./DiffViewer";

interface WorkingChangesPanelProps {
  onClose: () => void;
}

export function WorkingChangesPanel({ onClose }: WorkingChangesPanelProps) {
  const selectedWorktreePath = useGitStore((s) => s.selectedWorktreePath);
  const workingChanges = useGitStore((s) => s.workingChanges);
  const isLoading = useGitStore((s) => s.isWorkingChangesLoading);
  const error = useGitStore((s) => s.workingChangesError);
  const fetchWorkingChanges = useGitStore((s) => s.fetchWorkingChanges);

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

  if (!selectedWorktreePath) return null;

  // Short label from path (last 2 segments)
  const shortPath = selectedWorktreePath.split("/").slice(-2).join("/");

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="border-t border-white/[0.06] bg-white/[0.02] flex flex-col max-h-[50vh]"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-white/[0.03] border-b border-white/[0.04]">
        <FolderGit2 className="h-3.5 w-3.5 text-text-muted" />
        <span className="text-xs font-medium text-text-secondary">
          Working Changes
        </span>
        <span className="text-[10px] text-text-muted font-mono truncate">
          {shortPath}
        </span>
        <div className="flex-1" />
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
            <span className="ml-2 text-xs text-text-muted">Loading changes...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 py-8">
            <AlertCircle className="h-4 w-4 text-red-400" />
            <span className="text-xs text-red-400">{error || "An unknown error occurred"}</span>
          </div>
        ) : workingChanges ? (
          workingChanges.stats.filesChanged === 0 ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs text-text-muted">No uncommitted changes</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Stats summary */}
              <div className="text-xs text-text-muted">
                {workingChanges.stats.filesChanged} files changed,{" "}
                <span className="text-green-400">+{workingChanges.stats.insertions}</span>
                {" insertions, "}
                <span className="text-red-400">-{workingChanges.stats.deletions}</span>
                {" deletions"}
              </div>

              {/* Staged section */}
              <DiffFileList
                files={workingChanges.staged}
                sectionLabel="Staged"
                defaultExpanded={true}
              />

              {/* Unstaged section */}
              <DiffFileList
                files={workingChanges.unstaged}
                sectionLabel="Unstaged"
                defaultExpanded={true}
              />

              {/* Untracked section */}
              <DiffFileList
                files={workingChanges.untracked}
                sectionLabel="Untracked"
                defaultExpanded={false}
              />
            </div>
          )
        ) : (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-text-muted">No data available</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
