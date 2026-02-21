import { linkVertical } from "d3-shape";
import { motion } from "motion/react";
import type { GraphEdge } from "../types";
import { COLUMN_WIDTH, ROW_HEIGHT } from "../types";

interface BranchLineProps {
  edge: GraphEdge;
}

const verticalLink = linkVertical<unknown, { x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y);

export function BranchLine({ edge }: BranchLineProps) {
  const x1 = edge.fromX * COLUMN_WIDTH;
  const y1 = edge.fromY * ROW_HEIGHT + ROW_HEIGHT / 2;
  const x2 = edge.toX * COLUMN_WIDTH;
  const y2 = edge.toY * ROW_HEIGHT + ROW_HEIGHT / 2;

  if (edge.type === "straight") {
    return (
      <motion.line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={edge.color}
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.6}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3, delay: edge.fromY * 0.01 }}
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
      strokeWidth={2}
      strokeLinecap="round"
      opacity={0.6}
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 0.6 }}
      transition={{
        pathLength: { type: "spring", stiffness: 300, damping: 30 },
        opacity: { duration: 0.3 },
      }}
    />
  );
}
