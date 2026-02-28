import { useSshGitStore } from "../stores/sshGitStore";
import { useSshStore } from "../stores/sshStore";
import { useGitGraph, BranchGraph } from "../../git";
import { SshCommitDetailPanel } from "./SshCommitDetailPanel";
import { useSshGitPolling } from "../hooks/useSshGitPolling";
import { useState, useRef, useCallback, useEffect } from "react";
import { GitBranch, RefreshCw, Globe } from "lucide-react";

interface SshGitGraphPageProps {
  connectionId: string;
  isActive: boolean;
}

export default function SshGitGraphPage({ connectionId, isActive }: SshGitGraphPageProps) {
  const connection = useSshStore((s) =>
    s.connections.find((c) => c.id === connectionId),
  );
  const graphData = useSshGitStore((s) => s.graphData[connectionId]);
  const isLoading = useSshGitStore((s) => s.isConnectionLoading(connectionId));
  const error = useSshGitStore((s) => s.getConnectionError(connectionId));
  const selectedCommitHash = useSshGitStore((s) => s.selectedCommitHash);
  const selectCommit = useSshGitStore((s) => s.selectCommit);
  const fetchGraphData = useSshGitStore((s) => s.fetchGraphData);
  const fetchMoreCommits = useSshGitStore((s) => s.fetchMoreCommits);
  const pagination = useSshGitStore((s) => s.getPagination(connectionId));

  const [panelMaximized, setPanelMaximized] = useState(false);
  const togglePanelMaximize = useCallback(() => setPanelMaximized((p) => !p), []);

  const handleCloseCommit = useCallback(() => {
    selectCommit(null);
    setPanelMaximized(false);
  }, [selectCommit]);

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

  // Close detail panel when navigating away
  useEffect(() => {
    if (!isActive) {
      selectCommit(null);
      setPanelMaximized(false);
    }
  }, [isActive, selectCommit]);

  // Poll for git updates
  useSshGitPolling(connectionId, isActive);

  // Compute layout
  const layout = useGitGraph(graphData);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await fetchGraphData(connectionId);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchGraphData, connectionId, isRefreshing]);

  const handleLoadMore = useCallback(() => {
    fetchMoreCommits(connectionId);
  }, [fetchMoreCommits, connectionId]);

  // Connection not found
  if (!connection) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Globe className="h-16 w-16 text-text-muted opacity-40" strokeWidth={1} />
          <p className="text-sm text-text-muted">
            SSH connection not found
          </p>
        </div>
      </div>
    );
  }

  // No remote project path configured
  if (!connection.remoteProjectPath) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <GitBranch className="h-16 w-16 text-text-muted opacity-40" strokeWidth={1} />
          <p className="text-sm text-text-muted">
            No remote project path configured for this connection
          </p>
        </div>
      </div>
    );
  }

  // Error — not a git repository
  if (error && error.includes("not a git repository")) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <GitBranch className="h-16 w-16 text-text-muted opacity-40" strokeWidth={1} />
          <p className="text-sm text-text-muted">
            The remote directory is not a Git repository
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
          <p className="text-sm text-text-muted">Loading remote git history...</p>
        </div>
      </div>
    );
  }

  // Generic error state
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
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Refresh toolbar */}
        {!panelMaximized && (
          <div className="flex items-center justify-between px-3 py-1 border-b border-border/40">
            <span className="text-xs text-text-muted truncate">
              {connection.name} &mdash; {connection.remoteProjectPath}
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        )}
        <div className={panelMaximized ? "hidden" : "flex-1 min-h-0"}>
          {layout.nodes.length > 0 ? (
            <BranchGraph
              layout={layout}
              highlightBranch={hoveredBranch}
              onHoverBranch={handleHoverBranch}
              onLeaveBranch={handleLeaveBranch}
              scrollContainerRef={scrollContainerRef}
              onLoadMore={handleLoadMore}
              hasMore={pagination?.hasMore ?? false}
              isFetchingMore={pagination?.isFetchingMore ?? false}
              readOnly
              selectedHash={selectedCommitHash}
              onSelectCommit={selectCommit}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-text-muted">No commits yet</p>
            </div>
          )}
        </div>
        {isActive && selectedCommitHash && (
          <SshCommitDetailPanel
            connectionId={connectionId}
            onClose={handleCloseCommit}
            maximized={panelMaximized}
            onToggleMaximize={togglePanelMaximize}
          />
        )}
      </div>
    </div>
  );
}
