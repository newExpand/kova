import { create } from "zustand";
import type { CommitDetail, GitGraphData, GitStatus, WorkingChanges } from "../../../lib/tauri/commands";
import {
  getCommitDetail, getGitGraph, getGitStatus, getWorkingChanges,
  gitStageFiles, gitStageAll, gitUnstageFiles, gitUnstageAll,
  gitDiscardFile, gitCreateCommit,
} from "../../../lib/tauri/commands";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface GitState {
  graphData: Record<string, GitGraphData>; // keyed by projectId
  loadingProjects: Record<string, boolean>; // per-project loading state
  errorByProject: Record<string, string>; // per-project errors
  selectedCommitHash: string | null;
  commitDetail: CommitDetail | null;
  isDetailLoading: boolean;
  detailError: string | null;
  // Working changes (mutual exclusive with commit detail)
  selectedWorktreePath: string | null;
  workingChanges: WorkingChanges | null;
  isWorkingChangesLoading: boolean;
  workingChangesError: string | null;
  // Commit & staging
  commitMessage: string;
  isCommitting: boolean;
  isStagingInProgress: boolean;
  commitError: string | null;
  lastCommitHash: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface GitActions {
  fetchGraphData: (
    projectId: string,
    projectPath: string,
    limit?: number,
  ) => Promise<void>;
  refreshStatus: (projectPath: string) => Promise<GitStatus | null>;
  selectCommit: (hash: string | null) => void;
  fetchCommitDetail: (projectPath: string, hash: string) => Promise<void>;
  clearCommitDetail: () => void;
  // Working changes
  selectWorktree: (worktreePath: string | null) => void;
  fetchWorkingChanges: (worktreePath: string) => Promise<void>;
  clearWorkingChanges: () => void;
  // Staging & commit
  stageFiles: (worktreePath: string, filePaths: string[]) => Promise<void>;
  stageAll: (worktreePath: string) => Promise<void>;
  unstageFiles: (worktreePath: string, filePaths: string[]) => Promise<void>;
  unstageAll: (worktreePath: string) => Promise<void>;
  discardFile: (worktreePath: string, filePath: string, isUntracked: boolean) => Promise<void>;
  commitChanges: (worktreePath: string, message: string, projectId: string, projectPath: string) => Promise<void>;
  setCommitMessage: (message: string) => void;
  clearCommitError: () => void;
  // Computed
  getGraphForProject: (projectId: string) => GitGraphData | undefined;
  isProjectLoading: (projectId: string) => boolean;
  getProjectError: (projectId: string) => string | null;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: GitState = {
  graphData: {},
  loadingProjects: {},
  errorByProject: {},
  selectedCommitHash: null,
  commitDetail: null,
  isDetailLoading: false,
  detailError: null,
  selectedWorktreePath: null,
  workingChanges: null,
  isWorkingChangesLoading: false,
  workingChangesError: null,
  commitMessage: "",
  isCommitting: false,
  isStagingInProgress: false,
  commitError: null,
  lastCommitHash: null,
};

// Commit-related state to clear on worktree switch
const commitInitialState = {
  commitMessage: "",
  isCommitting: false,
  isStagingInProgress: false,
  commitError: null,
  lastCommitHash: null,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Run a git staging command then refresh working changes for the given worktree. */
async function runAndRefresh(
  get: () => GitState & GitActions,
  set: (partial: Partial<GitState>) => void,
  worktreePath: string,
  action: () => Promise<void>,
): Promise<void> {
  set({ isStagingInProgress: true, commitError: null });
  try {
    await action();
    if (get().selectedWorktreePath === worktreePath) {
      await get().fetchWorkingChanges(worktreePath);
    }
  } catch (e) {
    console.error("[gitStore] action failed:", e);
    set({ commitError: toErrorMessage(e) });
  } finally {
    set({ isStagingInProgress: false });
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGitStore = create<GitState & GitActions>()((set, get) => ({
  ...initialState,

  // Computed
  getGraphForProject: (projectId: string) => get().graphData[projectId],
  isProjectLoading: (projectId: string) => get().loadingProjects[projectId] ?? false,
  getProjectError: (projectId: string) => get().errorByProject[projectId] ?? null,

  // Actions
  fetchGraphData: async (projectId, projectPath, limit) => {
    set((state) => ({
      loadingProjects: { ...state.loadingProjects, [projectId]: true },
      errorByProject: { ...state.errorByProject, [projectId]: undefined as unknown as string },
    }));
    try {
      const data = await getGitGraph(projectPath, limit);
      set((state) => ({
        graphData: { ...state.graphData, [projectId]: data },
        loadingProjects: { ...state.loadingProjects, [projectId]: false },
      }));
    } catch (e) {
      console.error("[gitStore] fetchGraphData failed:", e);
      set((state) => ({
        errorByProject: { ...state.errorByProject, [projectId]: toErrorMessage(e) },
        loadingProjects: { ...state.loadingProjects, [projectId]: false },
      }));
    }
  },

  refreshStatus: async (projectPath) => {
    try {
      return await getGitStatus(projectPath);
    } catch (e) {
      console.error("[gitStore] refreshStatus failed:", e);
      return null;
    }
  },

  selectCommit: (hash) => {
    if (hash === null) {
      set({ selectedCommitHash: null, commitDetail: null, isDetailLoading: false, detailError: null });
    } else {
      set({
        selectedCommitHash: hash,
        detailError: null,
        // Mutual exclusion: clear working changes + commit state
        selectedWorktreePath: null,
        workingChanges: null,
        isWorkingChangesLoading: false,
        workingChangesError: null,
        ...commitInitialState,
      });
    }
  },

  fetchCommitDetail: async (projectPath, hash) => {
    set({ isDetailLoading: true, detailError: null });
    try {
      const detail = await getCommitDetail(projectPath, hash);
      // Guard against stale response if user selected a different commit
      if (get().selectedCommitHash !== hash) return;
      set({ commitDetail: detail, isDetailLoading: false });
    } catch (e) {
      console.error("[gitStore] fetchCommitDetail failed:", e);
      // Guard against stale error if user selected a different commit
      if (get().selectedCommitHash !== hash) return;
      set({ commitDetail: null, isDetailLoading: false, detailError: toErrorMessage(e) });
    }
  },

  clearCommitDetail: () => set({ commitDetail: null, isDetailLoading: false, detailError: null }),

  // Working changes actions
  selectWorktree: (worktreePath) => {
    if (worktreePath === null) {
      set({
        selectedWorktreePath: null,
        workingChanges: null,
        isWorkingChangesLoading: false,
        workingChangesError: null,
        ...commitInitialState,
      });
    } else {
      set({
        selectedWorktreePath: worktreePath,
        workingChanges: null,
        workingChangesError: null,
        // Mutual exclusion: clear commit detail
        selectedCommitHash: null,
        commitDetail: null,
        isDetailLoading: false,
        detailError: null,
        // Reset commit state for new worktree
        ...commitInitialState,
      });
    }
  },

  fetchWorkingChanges: async (worktreePath) => {
    set({ isWorkingChangesLoading: true, workingChangesError: null });
    try {
      const changes = await getWorkingChanges(worktreePath);
      // Guard against stale response
      if (get().selectedWorktreePath !== worktreePath) return;
      set({ workingChanges: changes, isWorkingChangesLoading: false });
    } catch (e) {
      console.error("[gitStore] fetchWorkingChanges failed:", e);
      if (get().selectedWorktreePath !== worktreePath) return;
      set({ workingChanges: null, isWorkingChangesLoading: false, workingChangesError: toErrorMessage(e) });
    }
  },

  clearWorkingChanges: () => set({
    selectedWorktreePath: null,
    workingChanges: null,
    isWorkingChangesLoading: false,
    workingChangesError: null,
  }),

  // Staging & commit actions

  stageFiles: async (worktreePath, filePaths) => {
    await runAndRefresh(get, set, worktreePath, () => gitStageFiles(worktreePath, filePaths));
  },

  stageAll: async (worktreePath) => {
    await runAndRefresh(get, set, worktreePath, () => gitStageAll(worktreePath));
  },

  unstageFiles: async (worktreePath, filePaths) => {
    await runAndRefresh(get, set, worktreePath, () => gitUnstageFiles(worktreePath, filePaths));
  },

  unstageAll: async (worktreePath) => {
    await runAndRefresh(get, set, worktreePath, () => gitUnstageAll(worktreePath));
  },

  discardFile: async (worktreePath, filePath, isUntracked) => {
    await runAndRefresh(get, set, worktreePath, () => gitDiscardFile(worktreePath, filePath, isUntracked));
  },

  // Critical fix: separate commit from post-commit refresh
  commitChanges: async (worktreePath, message, projectId, projectPath) => {
    set({ isCommitting: true, commitError: null, lastCommitHash: null });
    try {
      const result = await gitCreateCommit(worktreePath, message);
      set({ lastCommitHash: result.shortHash, commitMessage: "" });
    } catch (e) {
      console.error("[gitStore] commitChanges failed:", e);
      set({ commitError: toErrorMessage(e) });
      return; // Do not attempt refresh if commit failed
    } finally {
      set({ isCommitting: false });
    }
    // Post-commit refresh — errors here should not confuse the user
    try {
      if (get().selectedWorktreePath === worktreePath) {
        await get().fetchWorkingChanges(worktreePath);
      }
      await get().fetchGraphData(projectId, projectPath);
    } catch (e) {
      console.error("[gitStore] post-commit refresh failed (commit succeeded):", e);
    }
  },

  setCommitMessage: (message) => set({ commitMessage: message }),

  clearCommitError: () => set({ commitError: null }),

  reset: () => set(initialState),
}));
