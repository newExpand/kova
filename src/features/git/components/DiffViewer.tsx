import { useState, useCallback, useEffect, useRef, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronRight, Plus, Minus, X } from "lucide-react";
import type { FileDiff, FileStatus } from "../../../lib/tauri/commands";

// ---------------------------------------------------------------------------
// Shared constants & utilities
// ---------------------------------------------------------------------------

export const STATUS_BADGES: Record<FileStatus, { label: string; className: string }> = {
  added: { label: "A", className: "bg-green-500/20 text-green-400" },
  modified: { label: "M", className: "bg-blue-500/20 text-blue-400" },
  deleted: { label: "D", className: "bg-red-500/20 text-red-400" },
  renamed: { label: "R", className: "bg-yellow-500/20 text-yellow-400" },
  untracked: { label: "U", className: "bg-purple-500/20 text-purple-400" },
};

export function getDiffLineClass(line: string): string {
  if (line.startsWith("@@")) {
    return "text-blue-400";
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "bg-[oklch(0.7_0.15_150/0.15)] text-[oklch(0.8_0.15_150)]";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "bg-[oklch(0.65_0.18_25/0.15)] text-[oklch(0.8_0.15_25)]";
  }
  return "";
}

// ---------------------------------------------------------------------------
// FileDiffRow — single file with collapsible diff patch
// ---------------------------------------------------------------------------

interface FileDiffRowProps {
  file: FileDiff;
  isExpanded: boolean;
  onToggle: (path: string) => void;
  onStageFile?: (path: string) => void;
  onUnstageFile?: (path: string) => void;
  onDiscardFile?: (path: string, isUntracked: boolean) => void;
  disabled?: boolean;
}

export const FileDiffRow = memo(function FileDiffRow({
  file,
  isExpanded,
  onToggle,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  disabled,
}: FileDiffRowProps) {
  const badge = STATUS_BADGES[file.status] ?? {
    label: "?",
    className: "bg-white/10 text-text-muted",
  };

  const handleToggle = useCallback(() => {
    onToggle(file.path);
  }, [onToggle, file.path]);

  // Discard confirmation: first click shows warning, second click within 3s executes
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const discardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDiscard = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDiscardFile) return;
    if (confirmDiscard) {
      if (discardTimerRef.current) clearTimeout(discardTimerRef.current);
      setConfirmDiscard(false);
      onDiscardFile(file.path, file.status === "untracked");
    } else {
      setConfirmDiscard(true);
      discardTimerRef.current = setTimeout(() => setConfirmDiscard(false), 3000);
    }
  }, [onDiscardFile, confirmDiscard, file.path, file.status]);

  useEffect(() => {
    return () => {
      if (discardTimerRef.current) clearTimeout(discardTimerRef.current);
    };
  }, []);

  return (
    <div className="rounded border border-white/[0.04]">
      <div className="flex w-full items-center gap-2 px-2 py-1.5 hover:bg-white/[0.04] transition-colors">
        <button
          type="button"
          onClick={handleToggle}
          className="flex flex-1 min-w-0 items-center gap-2 text-left"
        >
          <motion.span
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={{ duration: 0.15 }}
            className="shrink-0 text-text-muted"
          >
            <ChevronRight className="h-3 w-3" />
          </motion.span>

          <span
            className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold leading-none ${badge.className}`}
          >
            {badge.label}
          </span>

          <span className="flex-1 min-w-0 truncate font-mono text-sm text-text-secondary">
            {file.path}
          </span>

          <span className="shrink-0 text-xs">
            <span className="text-green-400">+{file.insertions}</span>
            {" "}
            <span className="text-red-400">-{file.deletions}</span>
          </span>
        </button>

        {/* Action buttons (only rendered when callbacks provided) */}
        {(onStageFile || onUnstageFile || onDiscardFile) && (
          <div className="flex items-center gap-0.5 shrink-0">
            {onStageFile && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onStageFile(file.path); }}
                disabled={disabled}
                className="rounded p-0.5 text-text-muted hover:text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-30"
                aria-label={`Stage ${file.path}`}
                title="Stage"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
            {onUnstageFile && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onUnstageFile(file.path); }}
                disabled={disabled}
                className="rounded p-0.5 text-text-muted hover:text-yellow-400 hover:bg-yellow-500/10 transition-colors disabled:opacity-30"
                aria-label={`Unstage ${file.path}`}
                title="Unstage"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
            )}
            {onDiscardFile && (
              <button
                type="button"
                onClick={handleDiscard}
                disabled={disabled}
                className={`rounded p-0.5 transition-colors disabled:opacity-30 ${
                  confirmDiscard
                    ? "text-red-400 bg-red-500/20"
                    : "text-text-muted hover:text-red-400 hover:bg-red-500/10"
                }`}
                aria-label={confirmDiscard ? `Confirm discard ${file.path}` : `Discard ${file.path}`}
                title={confirmDiscard ? "Click again to confirm" : "Discard"}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {isExpanded && file.patch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <pre className="px-2 py-1 text-xs leading-[1.6] font-mono overflow-x-auto border-t border-white/[0.04]">
              {file.patch.split("\n").map((line, i) => (
                <div key={i} className={getDiffLineClass(line)}>
                  {line}
                </div>
              ))}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ---------------------------------------------------------------------------
// DiffFileList — section with label + expand/collapse all
// ---------------------------------------------------------------------------

interface BulkAction {
  onAction: () => void;
  label: string;
}

interface DiffFileListProps {
  files: FileDiff[];
  sectionLabel?: string;
  defaultExpanded?: boolean;
  // Optional staging action callbacks
  onStageFile?: (path: string) => void;
  onUnstageFile?: (path: string) => void;
  onDiscardFile?: (path: string, isUntracked: boolean) => void;
  bulkAction?: BulkAction;
  disabled?: boolean;
}

export function DiffFileList({
  files,
  sectionLabel,
  defaultExpanded = true,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  bulkAction,
  disabled,
}: DiffFileListProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    () => defaultExpanded ? new Set(files.map((f) => f.path)) : new Set(),
  );

  // Re-sync expanded set when files change (e.g. worktree switch, data refresh)
  useEffect(() => {
    setExpandedFiles(defaultExpanded ? new Set(files.map((f) => f.path)) : new Set());
  }, [files, defaultExpanded]);

  const toggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (files.length === 0) return null;

  return (
    <div className="space-y-1">
      {sectionLabel && (
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
            {sectionLabel} ({files.length})
          </span>
          <div className="flex items-center gap-2">
            {bulkAction && (
              <button
                type="button"
                onClick={bulkAction.onAction}
                disabled={disabled}
                className="shrink-0 text-xs text-primary/80 hover:text-primary transition-colors disabled:opacity-30"
              >
                {bulkAction.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (expandedFiles.size === files.length) {
                  setExpandedFiles(new Set());
                } else {
                  setExpandedFiles(new Set(files.map((f) => f.path)));
                }
              }}
              className="shrink-0 text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              {expandedFiles.size === files.length ? "Collapse all" : "Expand all"}
            </button>
          </div>
        </div>
      )}
      <div className="space-y-0.5">
        {files.map((file) => (
          <FileDiffRow
            key={file.path}
            file={file}
            isExpanded={expandedFiles.has(file.path)}
            onToggle={toggleFile}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
            onDiscardFile={onDiscardFile}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
