import type { GitWorktree, GitStatus } from "../../../lib/tauri/commands";
import { GitBranch, PanelRightClose, PanelRightOpen } from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { AgentStatusBadge } from "./AgentStatusBadge";
import {
  useAgentActivityStore,
  normalizePathKey,
} from "../stores/agentActivityStore";

interface WorktreePanelProps {
  worktrees: GitWorktree[];
  status: GitStatus | undefined;
  collapsed: boolean;
  onToggle: () => void;
  projectId: string;
  hoveredBranch?: string | null;
  onHoverBranch?: (branch: string) => void;
  onLeaveBranch?: () => void;
}

export function WorktreePanel({
  worktrees,
  status,
  collapsed,
  onToggle,
  projectId,
  hoveredBranch,
  onHoverBranch,
  onLeaveBranch,
}: WorktreePanelProps) {
  const navigate = useNavigate();
  const handleNavigate = () => navigate(`/projects/${projectId}/terminal`);

  if (collapsed) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center border-l border-white/[0.06] glass-surface py-2">
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md p-1.5 text-text-muted hover:bg-white/[0.06] hover:text-text-secondary transition-colors"
          title="Expand worktree panel"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
        {/* Cross-highlight intentionally omitted in collapsed mode — dots are too small for hover interaction */}
        <div className="mt-3 flex flex-col items-center gap-2">
          {worktrees.map((wt) => (
            <WorktreeCollapsedDot key={wt.path} worktree={wt} onNavigate={handleNavigate} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-60 shrink-0 flex-col border-l border-white/[0.06] glass-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <span className="text-xs font-medium text-text-secondary">
          Worktrees
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md p-1 text-text-muted hover:bg-white/[0.06] hover:text-text-secondary transition-colors"
          title="Collapse panel"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Worktree list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {worktrees.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <GitBranch className="h-8 w-8 text-text-muted opacity-40" strokeWidth={1} />
            <p className="text-[11px] text-text-muted">No worktrees</p>
          </div>
        ) : (
          worktrees.map((wt) => (
            <WorktreeCard
              key={wt.path}
              worktree={wt}
              isRootDirty={wt.isMain && (status?.isDirty ?? false)}
              onNavigate={handleNavigate}
              isHighlighted={hoveredBranch === wt.branch}
              onHoverBranch={onHoverBranch}
              onLeaveBranch={onLeaveBranch}
            />
          ))
        )}
      </div>
    </div>
  );
}

function WorktreeCollapsedDot({ worktree, onNavigate }: { worktree: GitWorktree; onNavigate: () => void }) {
  const normalizedWtPath = normalizePathKey(worktree.path);
  const session = useAgentActivityStore((s) => {
    return s.sessions[normalizedWtPath];
  });
  const isActive = session?.status === "active";
  const isAlive = isActive || session?.status === "ready";

  return (
    <button
      type="button"
      onClick={onNavigate}
      className={`h-2 w-2 rounded-full cursor-pointer ${isActive ? "agent-breathing" : ""}`}
      style={{
        backgroundColor: isAlive || worktree.isMain
          ? "var(--color-success)"
          : "var(--color-primary)",
        "--breath-color": "oklch(0.65 0.18 150 / 0.4)",
      } as React.CSSProperties}
      title={worktree.branch ?? "detached"}
      aria-label={`Open terminal for ${worktree.branch ?? "detached HEAD"}`}
    />
  );
}

function WorktreeCard({
  worktree,
  isRootDirty,
  onNavigate,
  isHighlighted,
  onHoverBranch,
  onLeaveBranch,
}: {
  worktree: GitWorktree;
  isRootDirty: boolean;
  onNavigate: () => void;
  isHighlighted?: boolean;
  onHoverBranch?: (branch: string) => void;
  onLeaveBranch?: () => void;
}) {
  const isClaudeWorktree = worktree.path.includes(".claude/worktrees/");
  const session = useAgentActivityStore(
    (s) => s.sessions[normalizePathKey(worktree.path)],
  );
  const isAgentActive = session?.status === "active";
  let statusLabel = "";
  if (isRootDirty) statusLabel = "dirty";
  else if (worktree.isMain) statusLabel = "clean";
  const branchLabel = worktree.branch ?? "detached HEAD";

  let borderClasses: string;
  if (isHighlighted) {
    borderClasses = "bg-white/[0.05] border-white/[0.12]";
  } else if (isAgentActive) {
    borderClasses = "border-success/30 agent-breathing hover:bg-white/[0.05] hover:border-white/[0.12]";
  } else {
    borderClasses = "border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.12]";
  }

  return (
    <motion.button
      type="button"
      onClick={onNavigate}
      onMouseEnter={() => worktree.branch && onHoverBranch?.(worktree.branch)}
      onMouseLeave={() => onLeaveBranch?.()}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      animate={isHighlighted ? { scale: 1.02 } : { scale: 1 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      aria-label={`Open terminal for ${branchLabel}${statusLabel ? ` (${statusLabel})` : ""}`}
      className={`w-full cursor-pointer rounded-lg border bg-white/[0.02] p-2.5 space-y-1.5 text-left transition-colors duration-150 ease-out
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a2e]
        ${borderClasses}`}
      style={
        isAgentActive
          ? ({ "--breath-color": "oklch(0.65 0.18 150 / 0.4)" } as React.CSSProperties)
          : undefined
      }
    >
      {/* Branch name row */}
      <div className="flex items-center gap-1.5">
        {isClaudeWorktree && (
          <span className="text-[10px]" title="Claude Code worktree">
            🤖
          </span>
        )}
        <span className="truncate text-xs font-medium text-text">
          {branchLabel}
        </span>
        {worktree.isMain && (
          <span className="shrink-0 rounded bg-white/[0.06] px-1 py-0.5 text-[9px] text-text-muted">
            root
          </span>
        )}
      </div>

      {/* Details row */}
      <div className="flex items-center gap-2 text-[10px] text-text-muted">
        <span className="font-mono">{worktree.commitHash.slice(0, 7)}</span>
        {isRootDirty && (
          <span className="rounded bg-warning/20 px-1 py-0.5 text-warning">
            dirty
          </span>
        )}
        {!isRootDirty && worktree.isMain && (
          <span className="rounded bg-success/20 px-1 py-0.5 text-success">
            clean
          </span>
        )}
      </div>

      {/* Agent status — always visible */}
      <div className="pt-1 border-t border-white/[0.04]">
        <AgentStatusBadge
          status={session?.status ?? "idle"}
          lastMessage={session?.lastMessage}
          toolUseCount={session?.toolUseCount}
          fileEditCount={session?.fileEditCount}
          commitCount={session?.commitCount}
          errorCount={session?.errorCount}
          isWaitingForInput={session?.isWaitingForInput}
        />
      </div>
    </motion.button>
  );
}
