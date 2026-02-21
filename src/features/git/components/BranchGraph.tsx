import type { GraphLayout } from "../types";
import { COLUMN_WIDTH, ROW_HEIGHT } from "../types";
import { BranchLine } from "./BranchLine";
import { CommitNode } from "./CommitNode";
import { useGitStore } from "../stores/gitStore";

interface BranchGraphProps {
  layout: GraphLayout;
}

export function BranchGraph({ layout }: BranchGraphProps) {
  const selectedHash = useGitStore((s) => s.selectedCommitHash);
  const selectCommit = useGitStore((s) => s.selectCommit);

  const graphWidth = (layout.columns + 1) * COLUMN_WIDTH + 16;
  const svgHeight = layout.rows * ROW_HEIGHT;

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
          {/* Edges first (behind nodes) */}
          {layout.edges.map((edge, i) => (
            <BranchLine key={`e-${i}`} edge={edge} />
          ))}
          {/* Nodes */}
          {layout.nodes.map((node) => (
            <CommitNode
              key={node.commit.hash}
              node={node}
              isSelected={selectedHash === node.commit.hash}
              onSelect={() => selectCommit(node.commit.hash)}
            />
          ))}
        </g>
      </svg>

      {/* Commit message list */}
      <div className="flex-1 min-w-0">
        {layout.nodes.map((node) => (
          <button
            key={node.commit.hash}
            type="button"
            className={`flex w-full items-center gap-3 px-3 text-left transition-colors border-b border-white/[0.03] hover:bg-white/[0.04] ${
              selectedHash === node.commit.hash ? "bg-white/[0.06]" : ""
            }`}
            style={{ height: ROW_HEIGHT }}
            onClick={() => selectCommit(node.commit.hash)}
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
        ))}
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
