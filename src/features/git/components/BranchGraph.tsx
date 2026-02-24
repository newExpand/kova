import { useMemo, useEffect, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { GitCommit } from "../../../lib/tauri/commands";
import type { GraphLayout } from "../types";
import { COLUMN_WIDTH, ROW_HEIGHT } from "../types";
import { BranchLine } from "./BranchLine";
import { CommitNode } from "./CommitNode";
import { CommitContextMenu } from "./CommitContextMenu";
import { CreateBranchDialog } from "./CreateBranchDialog";
import { AuthorAvatar } from "./AuthorAvatar";
import { useGitStore } from "../stores/gitStore";
import { Sparkles } from "lucide-react";

/** Extra rows beyond node overscan for rendering long-spanning edges */
const EDGE_OVERSCAN = 20;

interface BranchGraphProps {
  layout: GraphLayout;
  projectId: string;
  projectPath: string;
  highlightBranch: string | null;
  onHoverBranch?: (branch: string) => void;
  onLeaveBranch?: () => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onLoadMore: () => void;
  hasMore: boolean;
  isFetchingMore: boolean;
}

export function BranchGraph({
  layout,
  projectId,
  projectPath,
  highlightBranch,
  onHoverBranch,
  onLeaveBranch,
  scrollContainerRef,
  onLoadMore,
  hasMore,
  isFetchingMore,
}: BranchGraphProps) {
  const selectedHash = useGitStore((s) => s.selectedCommitHash);
  const selectCommit = useGitStore((s) => s.selectCommit);

  // CreateBranchDialog state
  const [createBranchTarget, setCreateBranchTarget] = useState<{
    hash: string;
    shortHash: string;
    message: string;
  } | null>(null);

  const handleCreateBranch = useCallback(
    (c: GitCommit) => {
      setCreateBranchTarget({ hash: c.hash, shortHash: c.shortHash, message: c.message });
    },
    [],
  );

  // Virtualizer for fixed-height rows
  const rowVirtualizer = useVirtualizer({
    count: layout.rows,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
    useFlushSync: false, // React 19 compatibility
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // --- Infinite scroll trigger ---
  useEffect(() => {
    if (!hasMore || isFetchingMore) return;
    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem && lastItem.index >= layout.rows - 30) {
      onLoadMore();
    }
  }, [virtualItems, layout.rows, hasMore, isFetchingMore, onLoadMore]);

  // Compute highlight color from branch name
  const highlightColor = useMemo(() => {
    if (!highlightBranch) return null;
    for (const node of layout.nodes) {
      const hasRef = node.commit.refs.some(
        (r) => r.name === highlightBranch && (r.refType === "localBranch" || r.refType === "head"),
      );
      if (hasRef) return node.color;
    }
    return null;
  }, [highlightBranch, layout.nodes]);

  const isHighlighting = highlightColor !== null;

  // Map each node color → branch name
  const colorToBranch = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of layout.nodes) {
      if (map.has(node.color)) continue;
      const localRef = node.commit.refs.find((r) => r.refType === "localBranch");
      const headRef = node.commit.refs.find((r) => r.refType === "head");
      const name = localRef?.name ?? headRef?.name;
      if (name) map.set(node.color, name);
    }
    return map;
  }, [layout.nodes]);

  // --- Visible range for edge filtering ---
  const visibleStart = virtualItems[0]?.index ?? 0;
  const visibleEnd = virtualItems[virtualItems.length - 1]?.index ?? 0;
  const edgeStart = Math.max(0, visibleStart - EDGE_OVERSCAN);
  const edgeEnd = Math.min(layout.rows - 1, visibleEnd + EDGE_OVERSCAN);

  const visibleEdges = useMemo(() => {
    return layout.edges.filter((edge) => {
      const minY = Math.min(edge.fromY, edge.toY);
      const maxY = Math.max(edge.fromY, edge.toY);
      return maxY >= edgeStart && minY <= edgeEnd;
    });
  }, [layout.edges, edgeStart, edgeEnd]);

  const graphWidth = (layout.columns + 1) * COLUMN_WIDTH + 16;
  const totalHeight = rowVirtualizer.getTotalSize();

  return (
    <>
      <div
        ref={scrollContainerRef}
        className="h-full overflow-y-auto"
      >
        <div
          style={{ height: totalHeight, position: "relative", display: "flex" }}
        >
          {/* SVG graph lane */}
          <svg
            width={graphWidth}
            height={totalHeight}
            className="shrink-0"
            style={{ minWidth: graphWidth }}
          >
            <g transform="translate(16, 0)">
              {/* Edges (behind nodes) */}
              {visibleEdges.map((edge, i) => {
                const isDimmed = isHighlighting && edge.color !== highlightColor;
                return (
                  <BranchLine
                    key={`e-${edge.fromY}-${edge.toY}-${edge.fromX}-${edge.toX}-${i}`}
                    edge={edge}
                    isDimmed={isDimmed}
                    isHighlighted={isHighlighting && !isDimmed}
                  />
                );
              })}
              {/* Nodes (only visible) */}
              {virtualItems.map((virtualItem) => {
                const node = layout.nodes[virtualItem.index];
                if (!node) return null;
                const isDimmed = isHighlighting && node.color !== highlightColor;
                return (
                  <CommitNode
                    key={node.commit.hash}
                    node={node}
                    isSelected={selectedHash === node.commit.hash}
                    onSelect={() => selectCommit(node.commit.hash)}
                    isDimmed={isDimmed}
                  />
                );
              })}
            </g>
          </svg>

          {/* Commit message list (virtualized) */}
          <div className="flex-1 min-w-0 relative">
            {virtualItems.map((virtualItem) => {
              const node = layout.nodes[virtualItem.index];
              if (!node) return null;
              const isDimmed = isHighlighting && node.color !== highlightColor;
              const branch = colorToBranch.get(node.color) ?? null;

              return (
                <CommitContextMenu
                  key={node.commit.hash}
                  commit={node.commit}
                  projectId={projectId}
                  projectPath={projectPath}
                  onCreateBranch={handleCreateBranch}
                >
                  {({ onContextMenu, onRefContextMenu }) => (
                    <button
                      type="button"
                      className={`flex w-full items-center gap-3 px-3 text-left select-none transition-all duration-200 ease-in-out border-b border-white/[0.03] hover:bg-white/[0.04] ${
                        selectedHash === node.commit.hash ? "bg-white/[0.06]" : ""
                      }`}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: ROW_HEIGHT,
                        transform: `translateY(${virtualItem.start}px)`,
                        opacity: isDimmed ? 0.4 : 1,
                      }}
                      onClick={() => selectCommit(node.commit.hash)}
                      onContextMenu={onContextMenu}
                      onMouseEnter={() => branch && onHoverBranch?.(branch)}
                      onMouseLeave={() => onLeaveBranch?.()}
                    >
                      <AuthorAvatar
                        name={node.commit.authorName}
                        isAgent={node.commit.isAgentCommit}
                      />
                      <span className="shrink-0 font-mono text-[11px] text-text-muted">
                        {node.commit.shortHash}
                      </span>
                      <span className="truncate text-sm text-text-secondary">
                        {node.commit.message}
                      </span>
                      {node.commit.isAgentCommit && (
                        <span
                          className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5
                            text-[10px] font-bold leading-none
                            bg-purple-500/10 text-purple-300 border border-purple-400/20
                            shadow-[0_0_4px_oklch(0.6_0.2_290/0.2)]"
                          aria-label="AI Agent commit"
                        >
                          <Sparkles className="h-2.5 w-2.5" />
                          AI
                        </span>
                      )}
                      {/* Ref badges — right-click on a badge targets that specific branch */}
                      {node.commit.refs.map((ref) => (
                        <span
                          key={ref.name}
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${refBadgeClassName(ref.refType)}`}
                          onContextMenu={(e) => {
                            if (ref.refType === "localBranch" || ref.refType === "head") {
                              onRefContextMenu(e, ref.name);
                            }
                          }}
                        >
                          {ref.name}
                        </span>
                      ))}
                      <span className="ml-auto shrink-0 text-[11px] text-text-muted">
                        {formatRelativeDate(node.commit.date)}
                      </span>
                    </button>
                  )}
                </CommitContextMenu>
              );
            })}

            {/* Loading indicator at bottom */}
            {isFetchingMore && (
              <div
                style={{
                  position: "absolute",
                  top: totalHeight,
                  width: "100%",
                }}
                className="flex justify-center py-4"
              >
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-primary" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create branch dialog (single instance) */}
      <CreateBranchDialog
        open={createBranchTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCreateBranchTarget(null);
        }}
        commit={createBranchTarget ?? { hash: "", shortHash: "", message: "" }}
        projectId={projectId}
        projectPath={projectPath}
      />
    </>
  );
}

function refBadgeClassName(refType: string): string {
  switch (refType) {
    case "head":
      return "bg-primary/20 text-primary border border-primary/30";
    case "tag":
      return "bg-warning/20 text-warning border border-warning/30";
    case "remoteBranch":
      return "border border-dashed border-text-muted/30 text-text-muted";
    default:
      return "bg-white/[0.08] text-text-secondary";
  }
}

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHr < 24) return `${diffHr}h`;
  if (diffDay < 30) return `${diffDay}d`;
  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
}
