import { useState, useCallback, useRef, useEffect } from "react";
import type { GitWorktree, AgentType } from "../../../lib/tauri/commands";
import { selectTmuxWindow, AGENT_TYPES, DEFAULT_AGENT_TYPE } from "../../../lib/tauri/commands";
import { GitBranch, PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { NewAgentTaskDialog } from "./NewAgentTaskDialog";
import { WorktreeContextMenu } from "./WorktreeContextMenu";
import { useAgentActivityStore } from "../stores/agentActivityStore";
import { useGitStore } from "../stores/gitStore";

interface WorktreePanelProps {
  worktrees: GitWorktree[];
  collapsed: boolean;
  onToggle: () => void;
  projectId: string;
  projectPath: string;
  sessionName: string | null;
  agentType?: AgentType;
  hoveredBranch?: string | null;
  onHoverBranch?: (branch: string) => void;
  onLeaveBranch?: () => void;
  onSelectWorktreeChanges?: (worktreePath: string) => void;
}

export function WorktreePanel({
  worktrees,
  collapsed,
  onToggle,
  projectId,
  projectPath,
  sessionName,
  agentType = DEFAULT_AGENT_TYPE,
  hoveredBranch,
  onHoverBranch,
  onLeaveBranch,
  onSelectWorktreeChanges,
}: WorktreePanelProps) {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const fetchGraphData = useGitStore((s) => s.fetchGraphData);

  // --- Animation tracking ---
  const [isCreating, setIsCreating] = useState(false);
  const knownPathsRef = useRef<Set<string> | null>(null);
  const [enteringPaths, setEnteringPaths] = useState<Set<string>>(new Set());
  const [exitingPaths, setExitingPaths] = useState<Set<string>>(new Set());
  const exitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Detect new worktree paths for entrance animation
  useEffect(() => {
    const currentPaths = new Set(worktrees.map((w) => w.path));

    if (knownPathsRef.current === null) {
      // First render — seed known paths without triggering animation
      knownPathsRef.current = currentPaths;
      return;
    }

    const newPaths = new Set<string>();
    for (const path of currentPaths) {
      if (!knownPathsRef.current.has(path)) {
        newPaths.add(path);
      }
    }

    knownPathsRef.current = currentPaths;

    if (newPaths.size > 0) {
      setIsCreating(false);
      // Clear safety timeout since worktree arrived
      if (creatingTimeoutRef.current) {
        clearTimeout(creatingTimeoutRef.current);
        creatingTimeoutRef.current = null;
      }
      setEnteringPaths(newPaths);
      const timer = setTimeout(() => setEnteringPaths(new Set()), 350);
      return () => clearTimeout(timer);
    }
  }, [worktrees]);

  // Cleanup exit timers + creating timeout on unmount
  const creatingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      for (const timer of exitTimersRef.current.values()) {
        clearTimeout(timer);
      }
      if (creatingTimeoutRef.current) {
        clearTimeout(creatingTimeoutRef.current);
      }
    };
  }, []);

  // Callback: worktree created -> show skeleton, wait for worktree:ready event
  const handleCreated = useCallback(() => {
    setIsCreating(true);
    // Safety timeout: force clear skeleton after 30s if event never arrives
    if (creatingTimeoutRef.current) clearTimeout(creatingTimeoutRef.current);
    creatingTimeoutRef.current = setTimeout(() => {
      setIsCreating(false);
      creatingTimeoutRef.current = null;
      // Last-resort refresh in case event was missed
      fetchGraphData(projectId, projectPath);
    }, 30_000);
  }, [fetchGraphData, projectId, projectPath]);

  // Polling fallback: while skeleton is showing, poll fetchGraphData every 3s.
  // Handles edge cases where the worktree:ready event is missed.
  useEffect(() => {
    if (!isCreating) return;
    const id = setInterval(() => {
      fetchGraphData(projectId, projectPath);
    }, 3000);
    return () => clearInterval(id);
  }, [isCreating, fetchGraphData, projectId, projectPath]);

  // Callback: worktree deleted -> exit animation then delayed refresh
  // exitingPaths is only cleared AFTER fetchGraphData completes to prevent blink-back
  const handleDeleted = useCallback(
    (worktreePath: string) => {
      setExitingPaths((prev) => new Set(prev).add(worktreePath));

      const timer = setTimeout(() => {
        exitTimersRef.current.delete(worktreePath);
        fetchGraphData(projectId, projectPath).finally(() => {
          setExitingPaths((prev) => {
            const next = new Set(prev);
            next.delete(worktreePath);
            return next;
          });
        });
      }, 300);

      exitTimersRef.current.set(worktreePath, timer);
    },
    [fetchGraphData, projectId, projectPath],
  );

  const handleNavigate = useCallback(
    (worktree?: GitWorktree) => {
      // Optimistic navigation: navigate immediately
      navigate(`/projects/${projectId}/terminal`);

      // Background: select the matching tmux window (fire-and-forget)
      if (sessionName && worktree) {
        const isClaudeWt = worktree.path.includes(".claude/worktrees/");
        if (isClaudeWt) {
          const taskName = worktree.path
            .split(".claude/worktrees/")
            .pop()
            ?.replace(/\/$/, "");
          if (taskName) {
            selectTmuxWindow(sessionName, taskName).catch((e) => {
              console.warn(`Failed to select tmux window '${taskName}':`, e);
            });
          }
        } else if (worktree.isMain) {
          selectTmuxWindow(sessionName, "0").catch((e) => {
            console.warn("Failed to select main tmux window:", e);
          });
        }
      }
    },
    [navigate, projectId, sessionName],
  );

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
            <WorktreeCollapsedDot key={wt.path} worktree={wt} onNavigate={() => handleNavigate(wt)} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-60 shrink-0 flex-col overflow-hidden border-l border-white/[0.06] glass-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <span className="text-sm font-medium text-text-secondary">
          Worktrees
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-md p-1 text-text-muted hover:bg-white/[0.06] hover:text-text-secondary transition-colors"
            title="New agent worktree"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md p-1 text-text-muted hover:bg-white/[0.06] hover:text-text-secondary transition-colors"
            title="Collapse panel"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Worktree list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1.5">
        {worktrees.length === 0 && !isCreating ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <GitBranch className="h-8 w-8 text-text-muted opacity-40" strokeWidth={1} />
            <p className="text-xs text-text-muted">No worktrees</p>
          </div>
        ) : (
          worktrees.map((wt) => {
            const isExiting = exitingPaths.has(wt.path);
            return (
              <div
                key={wt.path}
                className={isExiting
                  ? "worktree-card-exit-wrapper"
                  : "grid grid-rows-[1fr] grid-cols-1"}
              >
                <div className={isExiting ? "overflow-hidden rounded-lg min-w-0" : "min-w-0"}>
                    <WorktreeContextMenu
                      worktree={wt}
                      projectId={projectId}
                      projectPath={projectPath}
                      sessionName={sessionName}
                      onDeleted={handleDeleted}
                    >
                      {({ onContextMenu }) => (
                        <WorktreeCard
                          worktree={wt}
                          onNavigate={() => handleNavigate(wt)}
                          onContextMenu={onContextMenu}
                          isHighlighted={hoveredBranch === wt.branch}
                          onHoverBranch={onHoverBranch}
                          onLeaveBranch={onLeaveBranch}
                          onSelectWorktreeChanges={onSelectWorktreeChanges}
                          isEntering={enteringPaths.has(wt.path)}
                          isExiting={isExiting}
                          agentType={agentType}
                        />
                      )}
                    </WorktreeContextMenu>
                </div>
              </div>
            );
          })
        )}
        {isCreating && <WorktreeSkeletonCard />}
      </div>

      <NewAgentTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        sessionName={sessionName}
        projectPath={projectPath}
        agentType={agentType}
        onCreated={handleCreated}
      />
    </div>
  );
}

function WorktreeSkeletonCard() {
  return (
    <div className="w-full rounded-lg border border-primary/20 bg-primary/5 p-2.5 space-y-2.5 skeleton-shimmer worktree-card-enter">
      <div className="flex items-center gap-1.5">
        <div className="h-4 w-24 rounded bg-white/[0.08]" />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-3 w-12 rounded bg-white/[0.06]" />
        <div className="h-3 w-8 rounded bg-white/[0.04]" />
      </div>
      <div className="pt-1.5 border-t border-white/[0.04]">
        <div className="h-1.5 w-16 rounded bg-primary/30" />
      </div>
    </div>
  );
}

function WorktreeCollapsedDot({ worktree, onNavigate }: { worktree: GitWorktree; onNavigate: () => void }) {
  const session = useAgentActivityStore((s) => s.getSessionForPath(worktree.path));
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
        "--breath-color": "oklch(0.65 0.18 150 / 0.25)",
      } as React.CSSProperties}
      title={worktree.branch ?? "detached"}
      aria-label={`Open terminal for ${worktree.branch ?? "detached HEAD"}`}
    />
  );
}

function WorktreeCard({
  worktree,
  onNavigate,
  onContextMenu,
  isHighlighted,
  onHoverBranch,
  onLeaveBranch,
  onSelectWorktreeChanges,
  isEntering,
  isExiting,
  agentType = DEFAULT_AGENT_TYPE,
}: {
  worktree: GitWorktree;
  onNavigate: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  isHighlighted?: boolean;
  onHoverBranch?: (branch: string) => void;
  onLeaveBranch?: () => void;
  onSelectWorktreeChanges?: (worktreePath: string) => void;
  isEntering?: boolean;
  isExiting?: boolean;
  agentType?: AgentType;
}) {
  const isClaudeWorktree = worktree.path.includes(".claude/worktrees/");
  const session = useAgentActivityStore((s) => s.getSessionForPath(worktree.path));
  const isAgentActive = session?.status === "active";
  // Per-worktree dirty state (null = status unknown, don't guess)
  const isDirty = worktree.status?.isDirty ?? false;
  const isClean = worktree.status ? !worktree.status.isDirty : false;
  let statusLabel = "";
  if (isDirty) statusLabel = "dirty";
  else if (isClean) statusLabel = "clean";
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
    <button
      type="button"
      onClick={onNavigate}
      onContextMenu={onContextMenu}
      onMouseEnter={() => worktree.branch && onHoverBranch?.(worktree.branch)}
      onMouseLeave={() => onLeaveBranch?.()}
      aria-label={`Open terminal for ${branchLabel}${statusLabel ? ` (${statusLabel})` : ""}`}
      className={`w-full min-w-0 overflow-hidden cursor-pointer rounded-lg border bg-white/[0.02] p-2.5 space-y-1.5 text-left
        transition-all duration-150 ease-out
        hover:scale-[1.02] active:scale-[0.98]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a2e]
        ${isHighlighted ? "scale-[1.02] " : ""}${borderClasses}${isEntering ? " worktree-card-enter" : ""}${isExiting ? " worktree-card-exit-inner" : ""}`}
      style={
        isAgentActive
          ? ({ "--breath-color": "oklch(0.65 0.18 150 / 0.25)" } as React.CSSProperties)
          : undefined
      }
    >
      {/* Branch name row */}
      <div className="flex items-center gap-1.5 min-w-0">
        {isClaudeWorktree && (
          <span className="text-[11px]" title={`${AGENT_TYPES[agentType].label} worktree`}>
            🤖
          </span>
        )}
        <span className="truncate text-sm font-medium text-text">
          {branchLabel}
        </span>
        {worktree.isMain && (
          <span className="shrink-0 rounded bg-white/[0.06] px-1 py-0.5 text-[10px] text-text-muted">
            root
          </span>
        )}
      </div>

      {/* Details row */}
      <div className="flex items-center gap-2 text-[11px] text-text-muted min-w-0">
        <span className="font-mono">{worktree.commitHash.slice(0, 7)}</span>
        {isDirty ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onSelectWorktreeChanges?.(worktree.path);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                onSelectWorktreeChanges?.(worktree.path);
              }
            }}
            title={worktree.status
              ? `${worktree.status.stagedCount} staged, ${worktree.status.unstagedCount} unstaged, ${worktree.status.untrackedCount} untracked — click to view`
              : "Has uncommitted changes — click to view"
            }
            className="shrink-0 rounded bg-warning/20 px-1 py-0.5 text-warning cursor-pointer hover:bg-warning/30 transition-colors"
          >
            {worktree.status
              ? `dirty (${worktree.status.stagedCount + worktree.status.unstagedCount + worktree.status.untrackedCount})`
              : "dirty"
            }
          </span>
        ) : isClean ? (
          <span className="shrink-0 rounded bg-success/20 px-1 py-0.5 text-success">
            clean
          </span>
        ) : null}
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
    </button>
  );
}
