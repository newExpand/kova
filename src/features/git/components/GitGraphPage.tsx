import { useGitStore } from "../stores/gitStore";
import { useGitPolling } from "../hooks/useGitPolling";
import { useGitGraph } from "../hooks/useGitGraph";
import { BranchGraph } from "./BranchGraph";
import { CommitDetailPanel } from "./CommitDetailPanel";
import { WorkingChangesPanel } from "./WorkingChangesPanel";
import { WorktreePanel } from "./WorktreePanel";
import { MergeProgressDialog } from "./MergeProgressDialog";
import { useProjectStore } from "../../project/stores/projectStore";
import { useTmuxSessions } from "../../tmux/hooks/useTmuxSessions";
import { useState, useRef, useCallback, useEffect } from "react";
import { GitBranch } from "lucide-react";

interface GitGraphPageProps {
  projectId: string;
  isActive: boolean;
}

export default function GitGraphPage({ projectId, isActive }: GitGraphPageProps) {
  const project = useProjectStore((s) =>
    s.projects.find((p) => p.id === projectId),
  );
  const { projectSessions } = useTmuxSessions(projectId);
  const sessionName = projectSessions[0]?.name ?? null;
  const graphData = useGitStore((s) => s.graphData[projectId]);
  const isLoading = useGitStore((s) => s.isProjectLoading(projectId));
  const error = useGitStore((s) => s.getProjectError(projectId));
  const selectedCommitHash = useGitStore((s) => s.selectedCommitHash);
  const selectCommit = useGitStore((s) => s.selectCommit);
  const selectedWorktreePath = useGitStore((s) => s.selectedWorktreePath);
  const selectWorktree = useGitStore((s) => s.selectWorktree);
  const fetchMoreCommits = useGitStore((s) => s.fetchMoreCommits);
  const pagination = useGitStore((s) => s.getPagination(projectId));
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const togglePanel = useCallback(() => setPanelCollapsed((p) => !p), []);
  const [panelMaximized, setPanelMaximized] = useState(false);
  const togglePanelMaximize = useCallback(() => setPanelMaximized((p) => !p), []);

  const handleCloseCommit = useCallback(() => {
    selectCommit(null);
    setPanelMaximized(false);
  }, [selectCommit]);

  const handleCloseWorktree = useCallback(() => {
    selectWorktree(null);
    setPanelMaximized(false);
  }, [selectWorktree]);
  const [hoveredBranch, setHoveredBranch] = useState<string | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleHoverBranch = useCallback((branch: string) => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setHoveredBranch(branch);
  }, []);

  const handleLeaveBranch = useCallback(() => {
    leaveTimerRef.current = setTimeout(() => {
      setHoveredBranch(null);
      leaveTimerRef.current = null;
    }, 50);
  }, []);

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);

  // Close detail panels when navigating away
  useEffect(() => {
    if (!isActive) {
      selectCommit(null);
      selectWorktree(null);
      setPanelMaximized(false);
    }
  }, [isActive, selectCommit, selectWorktree]);

  // Poll for git updates
  useGitPolling(projectId, project?.path ?? "", isActive);

  // Compute layout
  const layout = useGitGraph(graphData);

  const handleLoadMore = useCallback(() => {
    if (!project?.path) return;
    fetchMoreCommits(projectId, project.path);
  }, [fetchMoreCommits, projectId, project?.path]);

  // Empty state — not a git repo
  if (error && error.includes("not a git repository")) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <GitBranch className="h-16 w-16 text-text-muted opacity-40" strokeWidth={1} />
          <p className="text-sm text-text-muted">
            This directory is not a Git repository
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading && !graphData) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-primary" />
          <p className="text-sm text-text-muted">Loading git history...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <GitBranch className="h-16 w-16 text-danger opacity-40" strokeWidth={1} />
          <p className="text-sm text-text-muted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main graph area + detail panel */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className={panelMaximized ? "hidden" : "flex-1 min-h-0"}>
          {layout.nodes.length > 0 ? (
            <BranchGraph
              layout={layout}
              projectId={projectId}
              projectPath={project?.path ?? ""}
              highlightBranch={hoveredBranch}
              onHoverBranch={handleHoverBranch}
              onLeaveBranch={handleLeaveBranch}
              scrollContainerRef={scrollContainerRef}
              onLoadMore={handleLoadMore}
              hasMore={pagination?.hasMore ?? false}
              isFetchingMore={pagination?.isFetchingMore ?? false}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-text-muted">No commits yet</p>
            </div>
          )}
        </div>
        {isActive && selectedCommitHash && project?.path && (
          <CommitDetailPanel
            projectPath={project.path}
            onClose={handleCloseCommit}
            maximized={panelMaximized}
            onToggleMaximize={togglePanelMaximize}
          />
        )}
        {isActive && selectedWorktreePath && (
          <WorkingChangesPanel
            onClose={handleCloseWorktree}
            maximized={panelMaximized}
            onToggleMaximize={togglePanelMaximize}
            projectId={projectId}
            projectPath={project?.path ?? ""}
            sessionName={sessionName}
          />
        )}
      </div>

      {/* Worktree panel */}
      <WorktreePanel
        worktrees={graphData?.worktrees ?? []}
        collapsed={panelCollapsed}
        onToggle={togglePanel}
        projectId={projectId}
        projectPath={project?.path ?? ""}
        sessionName={sessionName}
        hoveredBranch={hoveredBranch}
        onHoverBranch={handleHoverBranch}
        onLeaveBranch={handleLeaveBranch}
        onSelectWorktreeChanges={selectWorktree}
      />

      {/* Merge to main dialog (single instance) */}
      <MergeProgressDialog projectId={projectId} />
    </div>
  );
}
