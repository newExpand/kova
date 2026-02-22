// Types
export type {
  GitCommit,
  GitRef,
  GitRefType,
  GitBranch,
  GitWorktree,
  GitStatus,
  GitGraphData,
  CommitDetail,
  CommitResult,
  DiffStats,
  FileDiff,
  FileStatus,
  WorkingChanges,
  GitCommitsPage,
  GraphNode,
  GraphEdge,
  GraphLayout,
} from "./types";
export { BRANCH_HUES, COLUMN_WIDTH, ROW_HEIGHT } from "./types";

// Stores
export { useGitStore } from "./stores/gitStore";
export {
  useAgentActivityStore,
  normalizePathKey,
} from "./stores/agentActivityStore";
export type { AgentStatus, AgentSessionState } from "./stores/agentActivityStore";
export { useMergeStore } from "./stores/mergeStore";
export type { MergeStatus } from "./stores/mergeStore";

// Hooks
export { useGitGraph } from "./hooks/useGitGraph";
export { useGitPolling } from "./hooks/useGitPolling";

// Components
export { ProjectTabSwitcher } from "./components/ProjectTabSwitcher";
export { NewAgentTaskDialog } from "./components/NewAgentTaskDialog";
export { WorktreeContextMenu } from "./components/WorktreeContextMenu";
export { CommitBox } from "./components/CommitBox";
