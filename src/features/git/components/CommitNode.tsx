import { useState } from "react";
import type { GraphNode } from "../types";
import { COLUMN_WIDTH, ROW_HEIGHT } from "../types";

interface CommitNodeProps {
  node: GraphNode;
  isSelected: boolean;
  onSelect: () => void;
}

export function CommitNode({ node, isSelected, onSelect }: CommitNodeProps) {
  const cx = node.x * COLUMN_WIDTH;
  const cy = node.y * ROW_HEIGHT + ROW_HEIGHT / 2;
  const baseR = node.isHead ? 6 : 5;
  const [hovered, setHovered] = useState(false);
  const r = hovered ? baseR + 2 : baseR;

  return (
    <g
      transform={`translate(${cx}, ${cy})`}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="cursor-pointer"
    >
      {/* Head glow */}
      {node.isHead && (
        <circle
          r={r + 6}
          fill="none"
          stroke={node.color}
          strokeWidth={1}
          opacity={0.2}
          style={{ filter: `drop-shadow(0 0 8px ${node.color})` }}
        />
      )}
      {/* Head white ring */}
      {node.isHead && (
        <circle
          r={r + 1.5}
          fill="none"
          stroke="rgba(255,255,255,0.8)"
          strokeWidth={2}
        />
      )}
      {/* Main node */}
      <circle
        r={r}
        fill={node.color}
        stroke={isSelected ? "white" : "none"}
        strokeWidth={isSelected ? 2 : 0}
        style={{ transition: "r 150ms ease-out" }}
      />
    </g>
  );
}
