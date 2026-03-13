import { create } from "zustand";
import type { CommitDetail, GitGraphData, GitStatus, WorkingChanges } from "../../../lib/tauri/commands";
import {
  getCommitDetail, getGitGraph, getGitCommitsPage, getGitStatus, getWorkingChanges,
  gitStageFiles, gitStageAll, gitUnstageFiles, gitUnstageAll,
  gitDiscardFile, gitCreateCommit,
  gitCreateBranch, gitDeleteBranch, gitSwitchBranch,
  gitFetchRemote,
} from "../../../lib/tauri/commands";
import { useAgentFileTrackingStore } from "../../files";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface PaginationState {
  offset: number;
  hasMore: boolean;
  isFetchingMore: boolean;
}

interface GitState {
  graphData: Record<string, GitGraphData>; // keyed by projectId
  loadingProjects: Record<string, boolean>; // per-project loading state
  errorByProject: Record<string, string | undefined>; // per-project errors
  /** Per-project generation counter — incremented on clearProject() to invalidate in-flight fetches */
  _graphGeneration: Record<string, number>;
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
  paginationByProject: Record<string, PaginationState>;
  // Remote fetch
  isFetching: boolean;
  lastFetchAt: number | null;
  // Branch operations
  isBranchOperationInProgress: boolean;
  branchOperationError: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 200;

interface GitActions {
  fetchGraphData: (
    projectId: string,
    projectPath: string,
    limit?: number,
  ) => Promise<void>;
  fetchMoreCommits: (projectId: string, projectPath: string) => Promise<void>;
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
  // Remote fetch
  fetchRemote: (projectPath: string) => Promise<boolean>;
  fetchAndRefreshGraph: (projectId: string, projectPath: string) => Promise<void>;
  // Branch management
  createBranch: (repoPath: string, branchName: string, startPoint: string, projectId: string) => Promise<void>;
  deleteBranch: (repoPath: string, branchName: string, force: boolean, projectId: string) => Promise<void>;
  switchBranch: (repoPath: string, branchName: string, projectId: string) => Promise<void>;
  clearBranchOperationError: () => void;
  clearProject: (projectId: string) => void;
  // Computed
  getGraphForProject: (projectId: string) => GitGraphData | undefined;
  isProjectLoading: (projectId: string) => boolean;
  getProjectError: (projectId: string) => string | null;
  getPagination: (projectId: string) => PaginationState | null;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: GitState = {
  graphData: {},
  loadingProjects: {},
  errorByProject: {},
  _graphGeneration: {},
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
  paginationByProject: {},
  isFetching: false,
  lastFetchAt: null,
  isBranchOperationInProgress: false,
  branchOperationError: null,
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
  getPagination: (projectId: string) => get().paginationByProject[projectId] ?? null,

  // Actions
  fetchGraphData: async (projectId, projectPath, limit = DEFAULT_PAGE_SIZE) => {
    const gen = get()._graphGeneration[projectId] ?? 0;
    set((state) => ({
      loadingProjects: { ...state.loadingProjects, [projectId]: true },
      errorByProject: { ...state.errorByProject, [projectId]: undefined },
    }));
    try {
      const data = await getGitGraph(projectPath, limit);
      if ((get()._graphGeneration[projectId] ?? 0) !== gen) return;
      set((state) => ({
        graphData: { ...state.graphData, [projectId]: data },
        loadingProjects: { ...state.loadingProjects, [projectId]: false },
        paginationByProject: {
          ...state.paginationByProject,
          [projectId]: {
            offset: data.commits.length,
            hasMore: data.commits.length >= limit,
            isFetchingMore: false,
          },
        },
      }));
    } catch (e) {
      if ((get()._graphGeneration[projectId] ?? 0) !== gen) return;
      console.error("[gitStore] fetchGraphData failed:", e);
      set((state) => ({
        errorByProject: { ...state.errorByProject, [projectId]: toErrorMessage(e) },
        loadingProjects: { ...state.loadingProjects, [projectId]: false },
      }));
    }
  },

  fetchMoreCommits: async (projectId, projectPath) => {
    const pagination = get().paginationByProject[projectId];
    if (!pagination || !pagination.hasMore || pagination.isFetchingMore) return;
    const gen = get()._graphGeneration[projectId] ?? 0;

    set((state) => ({
      paginationByProject: {
        ...state.paginationByProject,
        [projectId]: { ...pagination, isFetchingMore: true },
      },
    }));

    try {
      const page = await getGitCommitsPage(projectPath, pagination.offset, DEFAULT_PAGE_SIZE);
      if ((get()._graphGeneration[projectId] ?? 0) !== gen) return;
      const existing = get().graphData[projectId];
      if (!existing) {
        set((state) => ({
          paginationByProject: {
            ...state.paginationByProject,
            [projectId]: { ...pagination, isFetchingMore: false },
          },
        }));
        return;
      }

      // Deduplicate by hash
      const existingHashes = new Set(existing.commits.map((c) => c.hash));
      const newCommits = page.commits.filter((c) => !existingHashes.has(c.hash));

      set((state) => ({
        graphData: {
          ...state.graphData,
          [projectId]: {
            ...existing,
            commits: [...existing.commits, ...newCommits],
          },
        },
        paginationByProject: {
          ...state.paginationByProject,
          [projectId]: {
            offset: pagination.offset + page.commits.length,
            hasMore: page.hasMore,
            isFetchingMore: false,
          },
        },
      }));
    } catch (e) {
      if ((get()._graphGeneration[projectId] ?? 0) !== gen) return;
      console.error("[gitStore] fetchMoreCommits failed:", e);
      set((state) => ({
        paginationByProject: {
          ...state.paginationByProject,
          [projectId]: { ...pagination, isFetchingMore: false },
        },
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
    // Capture staged file paths BEFORE commit (after commit, staged list is empty)
    const staged = get().workingChanges?.staged;
    if (!staged) {
      console.warn(
        "[gitStore] commitChanges: workingChanges.staged unavailable; " +
        "committed files will not be removed from the working set",
      );
    }
    const stagedPaths = (staged ?? []).map((f) => f.path);

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
    // Post-commit cleanup — errors must not override commit success
    try {
      if (stagedPaths.length > 0) {
        useAgentFileTrackingStore
          .getState()
          .removeCommittedFiles(projectPath, stagedPaths);
      }
    } catch (e) {
      console.error("[gitStore] post-commit working set cleanup failed (commit succeeded):", e);
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

  // Remote fetch actions

  fetchRemote: async (projectPath) => {
    if (get().isFetching) return false;
    set({ isFetching: true });
    try {
      const result = await gitFetchRemote(projectPath);
      set({ lastFetchAt: Date.now() });
      return result.success;
    } catch (e) {
      console.error("[gitStore] fetchRemote failed:", e);
      return false;
    } finally {
      set({ isFetching: false });
    }
  },

  fetchAndRefreshGraph: async (projectId, projectPath) => {
    await get().fetchRemote(projectPath);
    await get().fetchGraphData(projectId, projectPath);
  },

  // Branch management actions

  createBranch: async (repoPath, branchName, startPoint, projectId) => {
    if (get().isBranchOperationInProgress) return;
    set({ isBranchOperationInProgress: true, branchOperationError: null });
    try {
      await gitCreateBranch(repoPath, branchName, startPoint);
    } catch (e) {
      console.error("[gitStore] createBranch failed:", e);
      set({ branchOperationError: toErrorMessage(e) });
      throw e;
    } finally {
      set({ isBranchOperationInProgress: false });
    }
    // Post-operation refresh — errors here should not confuse the user
    try {
      await get().fetchGraphData(projectId, repoPath);
    } catch (e) {
      console.error("[gitStore] post-branch-op refresh failed:", e);
    }
  },

  deleteBranch: async (repoPath, branchName, force, projectId) => {
    if (get().isBranchOperationInProgress) return;
    set({ isBranchOperationInProgress: true, branchOperationError: null });
    try {
      await gitDeleteBranch(repoPath, branchName, force);
    } catch (e) {
      console.error("[gitStore] deleteBranch failed:", e);
      set({ branchOperationError: toErrorMessage(e) });
      throw e;
    } finally {
      set({ isBranchOperationInProgress: false });
    }
    try {
      await get().fetchGraphData(projectId, repoPath);
    } catch (e) {
      console.error("[gitStore] post-branch-op refresh failed:", e);
    }
  },

  switchBranch: async (repoPath, branchName, projectId) => {
    if (get().isBranchOperationInProgress) return;
    set({ isBranchOperationInProgress: true, branchOperationError: null });
    try {
      await gitSwitchBranch(repoPath, branchName);
    } catch (e) {
      console.error("[gitStore] switchBranch failed:", e);
      set({ branchOperationError: toErrorMessage(e) });
      throw e;
    } finally {
      set({ isBranchOperationInProgress: false });
    }
    try {
      await get().fetchGraphData(projectId, repoPath);
    } catch (e) {
      console.error("[gitStore] post-branch-op refresh failed:", e);
    }
  },

  clearBranchOperationError: () => set({ branchOperationError: null }),

  clearProject: (projectId) => set((state) => {
    const { [projectId]: _g, ...graphData } = state.graphData;
    const { [projectId]: _l, ...loadingProjects } = state.loadingProjects;
    const { [projectId]: _e, ...errorByProject } = state.errorByProject;
    const { [projectId]: _p, ...paginationByProject } = state.paginationByProject;
    return {
      graphData,
      loadingProjects,
      errorByProject,
      paginationByProject,
      _graphGeneration: {
        ...state._graphGeneration,
        [projectId]: (state._graphGeneration[projectId] ?? 0) + 1,
      },
    };
  }),

  reset: () => set(initialState),
}));
