import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion } from "motion/react";
import { Sparkles, X, Copy, Check, AlertCircle, Maximize2, Minimize2 } from "lucide-react";
import { useGitStore } from "../stores/gitStore";
import { FileDiffRow } from "./DiffViewer";

interface CommitDetailPanelProps {
  projectPath: string;
  onClose: () => void;
  maximized: boolean;
  onToggleMaximize: () => void;
}

export function CommitDetailPanel({ projectPath, onClose, maximized, onToggleMaximize }: CommitDetailPanelProps) {
  const selectedHash = useGitStore((s) => s.selectedCommitHash);
  const commitDetail = useGitStore((s) => s.commitDetail);
  const isDetailLoading = useGitStore((s) => s.isDetailLoading);
  const detailError = useGitStore((s) => s.detailError);
  const fetchCommitDetail = useGitStore((s) => s.fetchCommitDetail);

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  // Fetch commit detail when selected hash changes
  useEffect(() => {
    if (selectedHash && projectPath) {
      fetchCommitDetail(projectPath, selectedHash);
    }
  }, [selectedHash, projectPath, fetchCommitDetail]);

  // Auto-expand all files when detail loads
  useEffect(() => {
    if (commitDetail?.files.length) {
      setExpandedFiles(new Set(commitDetail.files.map((f) => f.path)));
    }
  }, [commitDetail]);

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

  // Find the commit in graphData for meta info (author, date, parents)
  const graphData = useGitStore((s) => s.graphData);
  const selectedCommit = useMemo(() => {
    for (const data of Object.values(graphData)) {
      const found = data.commits.find((c) => c.hash === selectedHash);
      if (found) return found;
    }
    return null;
  }, [graphData, selectedHash]);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopyHash = useCallback(async () => {
    if (!commitDetail?.hash) return;
    try {
      await navigator.clipboard.writeText(commitDetail.hash);
      setCopied(true);
      setCopyFailed(false);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("[CommitDetailPanel] Clipboard write failed:", e);
      setCopyFailed(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyFailed(false), 2000);
    }
  }, [commitDetail?.hash]);

  const toggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);


  // Split message into subject and body
  const { subject, body } = useMemo(() => {
    if (!commitDetail?.fullMessage) return { subject: "", body: "" };
    const lines = commitDetail.fullMessage.split("\n");
    return {
      subject: lines[0] ?? "",
      body: lines.slice(1).join("\n").trim(),
    };
  }, [commitDetail?.fullMessage]);

  if (!selectedHash) return null;

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
        {/* Hash + copy button */}
        <button
          type="button"
          onClick={handleCopyHash}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-sm text-text-muted hover:bg-white/[0.06] transition-colors"
          title="Copy full hash"
        >
          {commitDetail?.hash.slice(0, 10) ?? selectedHash.slice(0, 10)}
          {copyFailed ? (
            <X className="h-3 w-3 text-red-400" />
          ) : copied ? (
            <Check className="h-3 w-3 text-green-400" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>

        {/* Agent badge */}
        {commitDetail?.isAgentCommit && (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5
              text-[11px] font-bold leading-none
              bg-purple-500/10 text-purple-300 border border-purple-400/20
              shadow-[0_0_6px_oklch(0.6_0.2_290/0.25)]"
            aria-label="Committed by AI Agent Claude"
          >
            <Sparkles className="h-3 w-3" />
            Claude
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Maximize/Minimize button */}
        <button
          type="button"
          onClick={onToggleMaximize}
          className="rounded p-1 text-text-muted hover:bg-white/[0.08] hover:text-text-secondary transition-colors"
          aria-label={maximized ? "Restore panel" : "Maximize panel"}
        >
          {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-text-muted hover:bg-white/[0.08] hover:text-text-secondary transition-colors"
          aria-label="Close commit details"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isDetailLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-primary" />
            <span className="ml-2 text-sm text-text-muted">Loading details...</span>
          </div>
        ) : commitDetail ? (
          <div className="space-y-3">
            {/* Message section */}
            <div>
              <h3 className="text-sm font-medium text-text-primary">{subject}</h3>
              {body && (
                <pre className="mt-1 text-sm text-text-muted whitespace-pre-wrap font-mono leading-relaxed">
                  {body}
                </pre>
              )}
            </div>

            {/* Meta section */}
            {selectedCommit && (
              <div className="text-sm text-text-muted space-y-0.5">
                <div>
                  {selectedCommit.authorName}
                  {" "}
                  <span className="text-text-muted/60">&lt;{selectedCommit.authorEmail}&gt;</span>
                  {"  \u00B7  "}
                  {new Date(selectedCommit.date).toLocaleString()}
                </div>
                {selectedCommit.parents.length > 0 && (
                  <div>
                    Parents:{" "}
                    {selectedCommit.parents.map((p, i) => (
                      <span key={p}>
                        {i > 0 && ", "}
                        <span className="font-mono">{p.slice(0, 7)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Stats summary + Expand/Collapse toggle */}
            <div className="flex items-center justify-between text-sm text-text-muted">
              <span>
                {commitDetail.stats.filesChanged} files changed,{" "}
                <span className="text-green-400">+{commitDetail.stats.insertions}</span>
                {" insertions, "}
                <span className="text-red-400">-{commitDetail.stats.deletions}</span>
                {" deletions"}
              </span>
              {commitDetail.files.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (expandedFiles.size === commitDetail.files.length) {
                      setExpandedFiles(new Set());
                    } else {
                      setExpandedFiles(new Set(commitDetail.files.map((f) => f.path)));
                    }
                  }}
                  className="shrink-0 text-xs text-text-muted hover:text-text-secondary transition-colors"
                >
                  {expandedFiles.size === commitDetail.files.length ? "Collapse all" : "Expand all"}
                </button>
              )}
            </div>

            {/* File diffs */}
            {commitDetail.files.length > 0 && (
              <div className="space-y-0.5">
                {commitDetail.files.map((file) => (
                  <FileDiffRow
                    key={file.path}
                    file={file}
                    isExpanded={expandedFiles.has(file.path)}
                    onToggle={toggleFile}
                  />
                ))}
              </div>
            )}
          </div>
        ) : detailError ? (
          <div className="flex items-center justify-center gap-2 py-8">
            <AlertCircle className="h-4 w-4 text-red-400" />
            <span className="text-sm text-red-400">{detailError}</span>
          </div>
        ) : (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-text-muted">No detail available</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
