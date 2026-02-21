import { useState, useCallback, useEffect, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronRight } from "lucide-react";
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
}

export const FileDiffRow = memo(function FileDiffRow({
  file,
  isExpanded,
  onToggle,
}: FileDiffRowProps) {
  const badge = STATUS_BADGES[file.status] ?? {
    label: "?",
    className: "bg-white/10 text-text-muted",
  };

  const handleToggle = useCallback(() => {
    onToggle(file.path);
  }, [onToggle, file.path]);

  return (
    <div className="rounded border border-white/[0.04]">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-white/[0.04] transition-colors"
      >
        <motion.span
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="shrink-0 text-text-muted"
        >
          <ChevronRight className="h-3 w-3" />
        </motion.span>

        <span
          className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold leading-none ${badge.className}`}
        >
          {badge.label}
        </span>

        <span className="flex-1 min-w-0 truncate font-mono text-xs text-text-secondary">
          {file.path}
        </span>

        <span className="shrink-0 text-[11px]">
          <span className="text-green-400">+{file.insertions}</span>
          {" "}
          <span className="text-red-400">-{file.deletions}</span>
        </span>
      </button>

      <AnimatePresence>
        {isExpanded && file.patch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <pre className="px-2 py-1 text-[11px] leading-[1.6] font-mono overflow-x-auto border-t border-white/[0.04]">
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

interface DiffFileListProps {
  files: FileDiff[];
  sectionLabel?: string;
  defaultExpanded?: boolean;
}

export function DiffFileList({
  files,
  sectionLabel,
  defaultExpanded = true,
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
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
            {sectionLabel} ({files.length})
          </span>
          <button
            type="button"
            onClick={() => {
              if (expandedFiles.size === files.length) {
                setExpandedFiles(new Set());
              } else {
                setExpandedFiles(new Set(files.map((f) => f.path)));
              }
            }}
            className="shrink-0 text-[11px] text-text-muted hover:text-text-secondary transition-colors"
          >
            {expandedFiles.size === files.length ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}
      <div className="space-y-0.5">
        {files.map((file) => (
          <FileDiffRow
            key={file.path}
            file={file}
            isExpanded={expandedFiles.has(file.path)}
            onToggle={toggleFile}
          />
        ))}
      </div>
    </div>
  );
}
