import { useMemo } from "react";
import type { GitGraphData } from "../../../lib/tauri/commands";
import type { GraphLayout, GraphNode, GraphEdge } from "../types";
import { BRANCH_HUES } from "../types";

/**
 * Hash a string to a deterministic hue index (0-7).
 * Uses djb2 algorithm for fast, well-distributed hashing.
 */
function hashToHueIndex(name: string): number {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 33) ^ name.charCodeAt(i);
  }
  return Math.abs(hash) % BRANCH_HUES.length;
}

function laneColor(laneIndex: number, refName: string | undefined): string {
  const hue = refName
    ? BRANCH_HUES[hashToHueIndex(refName)]
    : BRANCH_HUES[laneIndex % BRANCH_HUES.length];
  return `oklch(0.7 0.15 ${hue})`;
}

/**
 * Topology-based swimlane layout algorithm.
 *
 * Instead of relying on branch names (which only exist at branch tips),
 * this algorithm assigns lanes based on parent-child relationships:
 *
 * 1. Process commits newest → oldest (git log order)
 * 2. commits[0] (HEAD) gets lane 0
 * 3. Each commit pushes its lane to its first-parent
 * 4. Second+ parents (merge sources) get new lanes
 * 5. Lanes are freed when no longer referenced
 */
export function useGitGraph(
  graphData: GitGraphData | undefined,
): GraphLayout {
  return useMemo(() => {
    if (!graphData || graphData.commits.length === 0) {
      return { nodes: [], edges: [], columns: 0, rows: 0 };
    }

    const { commits } = graphData;

    // Build index: hash → array position
    const commitIndex = new Map<string, number>();
    commits.forEach((c, i) => commitIndex.set(c.hash, i));

    // Lane assignment: hash → lane index
    const commitLane = new Map<string, number>();
    // Track which lanes are active (lane index → occupying commit hash, or null if free)
    const lanes: (string | null)[] = [];
    // Track the "color source" for each lane (first ref name that used this lane)
    const laneRefName = new Map<number, string>();

    function allocateLane(): number {
      const free = lanes.indexOf(null);
      if (free >= 0) {
        return free;
      }
      lanes.push(null);
      return lanes.length - 1;
    }

    function freeLane(lane: number): void {
      lanes[lane] = null;
    }

    // --- Pass 1: Assign lanes (newest → oldest) ---
    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      if (!commit) continue;

      // If this commit doesn't have a lane yet (root / first commit processed),
      // allocate one
      if (!commitLane.has(commit.hash)) {
        const lane = allocateLane();
        commitLane.set(commit.hash, lane);
        lanes[lane] = commit.hash;
      }

      const myLane = commitLane.get(commit.hash)!;

      // Record ref name for color if this commit has one
      if (!laneRefName.has(myLane)) {
        const headRef = commit.refs.find((r) => r.refType === "head");
        const localRef = commit.refs.find((r) => r.refType === "localBranch");
        const remoteRef = commit.refs.find((r) => r.refType === "remoteBranch");
        const refName = headRef?.name ?? localRef?.name ?? remoteRef?.name;
        if (refName) {
          laneRefName.set(myLane, refName);
        }
      }

      // Push lane to parents
      for (let p = 0; p < commit.parents.length; p++) {
        const parentHash = commit.parents[p];
        if (!parentHash) continue;

        if (p === 0) {
          // First parent: inherits the same lane
          if (!commitLane.has(parentHash)) {
            commitLane.set(parentHash, myLane);
            lanes[myLane] = parentHash;
          } else {
            // Parent already has a lane (convergence point) — free my lane
            freeLane(myLane);
          }
        } else {
          // Second+ parent (merge source): allocate a new lane
          if (!commitLane.has(parentHash)) {
            const newLane = allocateLane();
            commitLane.set(parentHash, newLane);
            lanes[newLane] = parentHash;
          }
        }
      }

      // If commit has no parents (root commit), free its lane
      if (commit.parents.length === 0) {
        freeLane(myLane);
      }
    }

    const maxColumns = Math.max(lanes.length, 1);

    // --- Pass 2: Build nodes ---
    const nodes: GraphNode[] = commits.map((commit, idx) => {
      const lane = commitLane.get(commit.hash) ?? 0;
      const isHead = commit.refs.some((r) => r.refType === "head");
      const color = laneColor(lane, laneRefName.get(lane));

      return {
        commit,
        x: lane,
        y: idx,
        color,
        isHead,
      };
    });

    // --- Pass 3: Build edges ---
    const edges: GraphEdge[] = [];
    for (const node of nodes) {
      for (const parentHash of node.commit.parents) {
        const parentIdx = commitIndex.get(parentHash);
        if (parentIdx === undefined) continue;
        const parentNode = nodes[parentIdx];
        if (!parentNode) continue;

        edges.push({
          fromX: node.x,
          fromY: node.y,
          toX: parentNode.x,
          toY: parentNode.y,
          color: node.color,
          type: node.x === parentNode.x ? "straight" : "curve",
        });
      }
    }

    return {
      nodes,
      edges,
      columns: maxColumns,
      rows: commits.length,
    };
  }, [graphData]);
}
