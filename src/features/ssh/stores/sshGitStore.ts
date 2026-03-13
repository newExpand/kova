import { create } from "zustand";
import type {
  CommitDetail,
  GitGraphData,
} from "../../../lib/tauri/commands";
import {
  getRemoteGitGraph,
  getRemoteGitCommitsPage,
  getRemoteCommitDetail,
} from "../../../lib/tauri/commands";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface PaginationState {
  offset: number;
  hasMore: boolean;
  isFetchingMore: boolean;
}

interface SshGitState {
  graphData: Record<string, GitGraphData>; // keyed by connectionId
  loadingConnections: Record<string, boolean>;
  errorByConnection: Record<string, string | undefined>;
  selectedCommitHash: string | null;
  commitDetail: CommitDetail | null;
  isDetailLoading: boolean;
  detailError: string | null;
  paginationByConnection: Record<string, PaginationState>;
  /** Monotonically increasing counter to guard against stale fetchCommitDetail responses */
  _detailRequestId: number;
  /** Per-connection generation counter — incremented on clearConnection() to invalidate in-flight fetches */
  _graphGeneration: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 200;

interface SshGitActions {
  // Computed
  isConnectionLoading: (connectionId: string) => boolean;
  getConnectionError: (connectionId: string) => string | null;
  getPagination: (connectionId: string) => PaginationState | null;
  // Actions
  fetchGraphData: (connectionId: string, limit?: number) => Promise<void>;
  fetchMoreCommits: (connectionId: string) => Promise<void>;
  selectCommit: (hash: string | null) => void;
  fetchCommitDetail: (connectionId: string, hash: string) => Promise<void>;
  clearCommitDetail: () => void;
  clearConnection: (connectionId: string) => void;
  trimConnection: (connectionId: string, maxCommits?: number) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: SshGitState = {
  graphData: {},
  loadingConnections: {},
  errorByConnection: {},
  selectedCommitHash: null,
  commitDetail: null,
  isDetailLoading: false,
  detailError: null,
  paginationByConnection: {},
  _detailRequestId: 0,
  _graphGeneration: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSshGitStore = create<SshGitState & SshGitActions>()(
  (set, get) => ({
    ...initialState,

    // Computed
    isConnectionLoading: (connectionId: string) =>
      get().loadingConnections[connectionId] ?? false,
    getConnectionError: (connectionId: string) =>
      get().errorByConnection[connectionId] ?? null,
    getPagination: (connectionId: string) =>
      get().paginationByConnection[connectionId] ?? null,

    // Actions
    fetchGraphData: async (connectionId, limit = DEFAULT_PAGE_SIZE) => {
      const gen = get()._graphGeneration[connectionId] ?? 0;
      set((state) => ({
        loadingConnections: {
          ...state.loadingConnections,
          [connectionId]: true,
        },
        errorByConnection: {
          ...state.errorByConnection,
          [connectionId]: undefined,
        },
      }));
      try {
        const data = await getRemoteGitGraph(connectionId, limit);
        if ((get()._graphGeneration[connectionId] ?? 0) !== gen) return;
        set((state) => ({
          graphData: { ...state.graphData, [connectionId]: data },
          paginationByConnection: {
            ...state.paginationByConnection,
            [connectionId]: {
              offset: data.commits.length,
              hasMore: data.commits.length >= limit,
              isFetchingMore: false,
            },
          },
        }));
      } catch (e) {
        if ((get()._graphGeneration[connectionId] ?? 0) !== gen) return;
        console.error("[sshGitStore] fetchGraphData failed:", e);
        set((state) => ({
          errorByConnection: {
            ...state.errorByConnection,
            [connectionId]: toErrorMessage(e),
          },
        }));
      } finally {
        if ((get()._graphGeneration[connectionId] ?? 0) === gen) {
          set((state) => ({
            loadingConnections: {
              ...state.loadingConnections,
              [connectionId]: false,
            },
          }));
        }
      }
    },

    fetchMoreCommits: async (connectionId) => {
      const pagination = get().paginationByConnection[connectionId];
      if (!pagination || !pagination.hasMore || pagination.isFetchingMore)
        return;
      const gen = get()._graphGeneration[connectionId] ?? 0;

      set((state) => ({
        paginationByConnection: {
          ...state.paginationByConnection,
          [connectionId]: { ...pagination, isFetchingMore: true },
        },
      }));

      try {
        const page = await getRemoteGitCommitsPage(
          connectionId,
          pagination.offset,
          DEFAULT_PAGE_SIZE,
        );
        if ((get()._graphGeneration[connectionId] ?? 0) !== gen) return;
        const existing = get().graphData[connectionId];
        if (!existing) return;

        // Deduplicate by hash
        const existingHashes = new Set(
          existing.commits.map((c) => c.hash),
        );
        const newCommits = page.commits.filter(
          (c) => !existingHashes.has(c.hash),
        );

        set((state) => ({
          graphData: {
            ...state.graphData,
            [connectionId]: {
              ...existing,
              commits: [...existing.commits, ...newCommits],
            },
          },
          paginationByConnection: {
            ...state.paginationByConnection,
            [connectionId]: {
              offset: pagination.offset + page.commits.length,
              hasMore: page.hasMore,
              isFetchingMore: false,
            },
          },
        }));
      } catch (e) {
        if ((get()._graphGeneration[connectionId] ?? 0) !== gen) return;
        console.error("[sshGitStore] fetchMoreCommits failed:", e);
        set((state) => ({
          errorByConnection: {
            ...state.errorByConnection,
            [connectionId]: `Failed to load more commits: ${toErrorMessage(e)}`,
          },
        }));
      } finally {
        if ((get()._graphGeneration[connectionId] ?? 0) === gen) {
          set((state) => ({
            paginationByConnection: {
              ...state.paginationByConnection,
              [connectionId]: {
                ...(state.paginationByConnection[connectionId] ?? pagination),
                isFetchingMore: false,
              },
            },
          }));
        }
      }
    },

    selectCommit: (hash) => {
      if (hash === null) {
        set({
          selectedCommitHash: null,
          commitDetail: null,
          isDetailLoading: false,
          detailError: null,
        });
      } else {
        set({
          selectedCommitHash: hash,
          detailError: null,
        });
      }
    },

    fetchCommitDetail: async (connectionId, hash) => {
      const requestId = get()._detailRequestId + 1;
      set({ isDetailLoading: true, detailError: null, _detailRequestId: requestId });
      try {
        const detail = await getRemoteCommitDetail(connectionId, hash);
        if (get()._detailRequestId !== requestId) return;
        set({ commitDetail: detail });
      } catch (e) {
        console.error("[sshGitStore] fetchCommitDetail failed:", e);
        if (get()._detailRequestId !== requestId) return;
        set({
          commitDetail: null,
          detailError: toErrorMessage(e),
        });
      } finally {
        // Only clear loading if this is still the latest request
        if (get()._detailRequestId === requestId) {
          set({ isDetailLoading: false });
        }
      }
    },

    clearCommitDetail: () =>
      set({ commitDetail: null, isDetailLoading: false, detailError: null }),

    clearConnection: (connectionId) => set((state) => {
      const { [connectionId]: _g, ...graphData } = state.graphData;
      const { [connectionId]: _l, ...loadingConnections } = state.loadingConnections;
      const { [connectionId]: _e, ...errorByConnection } = state.errorByConnection;
      const { [connectionId]: _p, ...paginationByConnection } = state.paginationByConnection;
      return {
        graphData,
        loadingConnections,
        errorByConnection,
        paginationByConnection,
        _graphGeneration: {
          ...state._graphGeneration,
          [connectionId]: (state._graphGeneration[connectionId] ?? 0) + 1,
        },
      };
    }),

    trimConnection: (connectionId, maxCommits = 50) => set((state) => {
      const graph = state.graphData[connectionId];
      if (!graph || graph.commits.length <= maxCommits) return state;
      return {
        graphData: {
          ...state.graphData,
          [connectionId]: { ...graph, commits: graph.commits.slice(0, maxCommits) },
        },
        paginationByConnection: {
          ...state.paginationByConnection,
          [connectionId]: { offset: maxCommits, hasMore: true, isFetchingMore: false },
        },
        _graphGeneration: {
          ...state._graphGeneration,
          [connectionId]: (state._graphGeneration[connectionId] ?? 0) + 1,
        },
      };
    }),

    reset: () => set(initialState),
  }),
);
