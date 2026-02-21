export type {
  GitCommit,
  GitRef,
  GitRefType,
  GitBranch,
  GitWorktree,
  GitStatus,
  GitGraphData,
} from "../../lib/tauri/commands";

// ---------------------------------------------------------------------------
// Frontend-only layout types for SVG rendering
// ---------------------------------------------------------------------------

/** 8 oklch hue values for deterministic branch coloring */
export const BRANCH_HUES = [250, 170, 320, 30, 60, 140, 290, 200] as const;

export const COLUMN_WIDTH = 24;
export const ROW_HEIGHT = 36;

export interface GraphNode {
  commit: import("../../lib/tauri/commands").GitCommit;
  x: number; // column index
  y: number; // row index
  color: string; // CSS oklch color
  isHead: boolean;
}

export interface GraphEdge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  type: "straight" | "curve";
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  columns: number;
  rows: number;
}
