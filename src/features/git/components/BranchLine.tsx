import { linkVertical } from "d3-shape";
import { motion } from "motion/react";
import type { GraphEdge } from "../types";
import { COLUMN_WIDTH, ROW_HEIGHT } from "../types";

interface BranchLineProps {
  edge: GraphEdge;
  isDimmed?: boolean;
  isHighlighted?: boolean;
}

const verticalLink = linkVertical<unknown, { x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y);

export function BranchLine({ edge, isDimmed, isHighlighted }: BranchLineProps) {
  const x1 = edge.fromX * COLUMN_WIDTH;
  const y1 = edge.fromY * ROW_HEIGHT + ROW_HEIGHT / 2;
  const x2 = edge.toX * COLUMN_WIDTH;
  const y2 = edge.toY * ROW_HEIGHT + ROW_HEIGHT / 2;

  let baseOpacity = 0.6;
  if (isDimmed) baseOpacity = 0.2;
  else if (isHighlighted) baseOpacity = 1;

  const width = isHighlighted ? 3 : 2;

  let filter = "none";
  if (isHighlighted) {
    filter = `drop-shadow(0 0 3px ${edge.color})`;
  } else if (isDimmed) {
    filter = "grayscale(1)";
  }

  const highlightStyle: React.CSSProperties = {
    filter,
    transition: "stroke-width 200ms ease-in-out, filter 200ms ease-in-out",
  };

  if (edge.type === "straight") {
    return (
      <motion.line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={edge.color}
        strokeWidth={width}
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: baseOpacity }}
        transition={{ duration: 0.3, delay: edge.fromY * 0.01 }}
        style={highlightStyle}
      />
    );
  }

  // Curved connection using d3 linkVertical
  const pathData = verticalLink({
    source: { x: x1, y: y1 },
    target: { x: x2, y: y2 },
  });

  return (
    <motion.path
      d={pathData ?? ""}
      fill="none"
      stroke={edge.color}
      strokeWidth={width}
      strokeLinecap="round"
      opacity={baseOpacity}
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: baseOpacity }}
      transition={{
        pathLength: { type: "spring", stiffness: 300, damping: 30 },
        opacity: { duration: 0.3 },
      }}
      style={highlightStyle}
    />
  );
}
