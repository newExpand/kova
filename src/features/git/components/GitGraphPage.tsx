import { useGitStore } from "../stores/gitStore";
import { useGitPolling } from "../hooks/useGitPolling";
import { useGitGraph } from "../hooks/useGitGraph";
import { BranchGraph } from "./BranchGraph";
import { WorktreePanel } from "./WorktreePanel";
import { useProjectStore } from "../../project/stores/projectStore";
import { useState } from "react";
import { GitBranch } from "lucide-react";

interface GitGraphPageProps {
  projectId: string;
  isActive: boolean;
}

export default function GitGraphPage({ projectId, isActive }: GitGraphPageProps) {
  const project = useProjectStore((s) =>
    s.projects.find((p) => p.id === projectId),
  );
  const graphData = useGitStore((s) => s.graphData[projectId]);
  const isLoading = useGitStore((s) => s.isProjectLoading(projectId));
  const error = useGitStore((s) => s.getProjectError(projectId));
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // Poll for git updates
  useGitPolling(projectId, project?.path ?? "", isActive);

  // Compute layout
  const layout = useGitGraph(graphData);

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
          <p className="text-xs text-text-muted">Loading git history...</p>
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
      {/* Main graph area */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {layout.nodes.length > 0 ? (
          <BranchGraph layout={layout} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text-muted">No commits yet</p>
          </div>
        )}
      </div>

      {/* Worktree panel */}
      <WorktreePanel
        worktrees={graphData?.worktrees ?? []}
        status={graphData?.status}
        collapsed={panelCollapsed}
        onToggle={() => setPanelCollapsed((p) => !p)}
      />
    </div>
  );
}
