import { create } from "zustand";
import type { CommitDetail, GitGraphData, GitStatus } from "../../../lib/tauri/commands";
import { getCommitDetail, getGitGraph, getGitStatus } from "../../../lib/tauri/commands";

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
};

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
      const message = e instanceof Error ? e.message : String(e);
      console.error("[gitStore] fetchGraphData failed:", e);
      set((state) => ({
        errorByProject: { ...state.errorByProject, [projectId]: message },
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
      set({ selectedCommitHash: hash, detailError: null });
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
      const message = e instanceof Error ? e.message : String(e);
      console.error("[gitStore] fetchCommitDetail failed:", e);
      // Guard against stale error if user selected a different commit
      if (get().selectedCommitHash !== hash) return;
      set({ commitDetail: null, isDetailLoading: false, detailError: message });
    }
  },

  clearCommitDetail: () => set({ commitDetail: null, isDetailLoading: false, detailError: null }),

  reset: () => set(initialState),
}));
