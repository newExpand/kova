import type { GitWorktree, GitStatus } from "../../../lib/tauri/commands";
import { GitBranch, PanelRightClose, PanelRightOpen } from "lucide-react";
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
}

export function WorktreePanel({
  worktrees,
  status,
  collapsed,
  onToggle,
}: WorktreePanelProps) {
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
        <div className="mt-3 flex flex-col items-center gap-2">
          {worktrees.map((wt) => (
            <WorktreeCollapsedDot key={wt.path} worktree={wt} />
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
            />
          ))
        )}
      </div>
    </div>
  );
}

function WorktreeCollapsedDot({ worktree }: { worktree: GitWorktree }) {
  const normalizedWtPath = normalizePathKey(worktree.path);
  const session = useAgentActivityStore((s) => {
    return s.sessions[normalizedWtPath];
  });
  const isActive = session?.status === "active";
  const isAlive = isActive || session?.status === "ready";

  return (
    <div
      className={`h-2 w-2 rounded-full ${isActive ? "agent-breathing" : ""}`}
      style={{
        backgroundColor: isAlive
          ? "var(--color-success)"
          : worktree.isMain
            ? "var(--color-success)"
            : "var(--color-primary)",
        "--breath-color": "oklch(0.65 0.18 150 / 0.4)",
      } as React.CSSProperties}
      title={worktree.branch ?? "detached"}
    />
  );
}

function WorktreeCard({
  worktree,
  isRootDirty,
}: {
  worktree: GitWorktree;
  isRootDirty: boolean;
}) {
  const isClaudeWorktree = worktree.path.includes(".claude/worktrees/");
  const session = useAgentActivityStore(
    (s) => s.sessions[normalizePathKey(worktree.path)],
  );
  const isAgentActive = session?.status === "active";

  return (
    <div
      className={`rounded-lg border bg-white/[0.02] p-2.5 space-y-1.5 ${
        isAgentActive
          ? "border-success/30 agent-breathing"
          : "border-white/[0.06]"
      }`}
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
          {worktree.branch ?? "detached HEAD"}
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
    </div>
  );
}
