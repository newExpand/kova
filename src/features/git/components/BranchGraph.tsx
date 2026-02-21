import { useMemo } from "react";
import type { GraphLayout } from "../types";
import { COLUMN_WIDTH, ROW_HEIGHT } from "../types";
import { BranchLine } from "./BranchLine";
import { CommitNode } from "./CommitNode";
import { useGitStore } from "../stores/gitStore";

interface BranchGraphProps {
  layout: GraphLayout;
  highlightBranch?: string | null;
  onHoverBranch?: (branch: string) => void;
  onLeaveBranch?: () => void;
}

export function BranchGraph({ layout, highlightBranch, onHoverBranch, onLeaveBranch }: BranchGraphProps) {
  const selectedHash = useGitStore((s) => s.selectedCommitHash);
  const selectCommit = useGitStore((s) => s.selectCommit);

  // Compute highlight color from branch name
  const highlightColor = useMemo(() => {
    if (!highlightBranch) return null;
    for (const node of layout.nodes) {
      const hasRef = node.commit.refs.some(
        (r) => r.name === highlightBranch && (r.refType === "localBranch" || r.refType === "head"),
      );
      if (hasRef) return node.color;
    }
    console.debug(`[BranchGraph] Branch "${highlightBranch}" not found in visible commits`);
    return null;
  }, [highlightBranch, layout.nodes]);

  const isHighlighting = highlightColor !== null;

  const graphWidth = (layout.columns + 1) * COLUMN_WIDTH + 16;
  const svgHeight = layout.rows * ROW_HEIGHT;

  // Map each node color → branch name by finding the tip commit with that color
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

  return (
    <div className="flex min-h-0" style={{ minHeight: svgHeight }}>
      {/* SVG graph lane */}
      <svg
        width={graphWidth}
        height={svgHeight}
        className="shrink-0"
        style={{ minWidth: graphWidth }}
      >
        <g transform="translate(16, 0)">
          {/* Edges first (behind nodes) — dimmed edges rendered first */}
          {layout.edges.map((edge, i) => {
            const isDimmed = isHighlighting && edge.color !== highlightColor;
            return (
              <BranchLine key={`e-${i}`} edge={edge} isDimmed={isDimmed} isHighlighted={isHighlighting && !isDimmed} />
            );
          })}
          {/* Nodes */}
          {layout.nodes.map((node) => {
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

      {/* Commit message list */}
      <div className="flex-1 min-w-0">
        {layout.nodes.map((node) => {
          const isDimmed = isHighlighting && node.color !== highlightColor;
          const branch = colorToBranch.get(node.color) ?? null;

          return (
            <button
              key={node.commit.hash}
              type="button"
              className={`flex w-full items-center gap-3 px-3 text-left transition-all duration-200 ease-in-out border-b border-white/[0.03] hover:bg-white/[0.04] ${
                selectedHash === node.commit.hash ? "bg-white/[0.06]" : ""
              }`}
              style={{
                height: ROW_HEIGHT,
                opacity: isDimmed ? 0.4 : 1,
              }}
              onClick={() => selectCommit(node.commit.hash)}
              onMouseEnter={() => branch && onHoverBranch?.(branch)}
              onMouseLeave={() => onLeaveBranch?.()}
            >
              <span className="shrink-0 font-mono text-[10px] text-text-muted">
                {node.commit.shortHash}
              </span>
              <span className="truncate text-xs text-text-secondary">
                {node.commit.message}
              </span>
              {/* Ref badges */}
              {node.commit.refs.map((ref) => (
                <span
                  key={ref.name}
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold leading-none ${
                    ref.refType === "head"
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : ref.refType === "tag"
                        ? "bg-warning/20 text-warning border border-warning/30"
                        : ref.refType === "remoteBranch"
                          ? "border border-dashed border-text-muted/30 text-text-muted"
                          : "bg-white/[0.08] text-text-secondary"
                  }`}
                >
                  {ref.name}
                </span>
              ))}
              <span className="ml-auto shrink-0 text-[10px] text-text-muted">
                {formatRelativeDate(node.commit.date)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
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
