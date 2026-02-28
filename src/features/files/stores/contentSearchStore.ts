import { create } from "zustand";
import type { ContentSearchResult } from "../../../lib/tauri/commands";
import { searchFileContents } from "../../../lib/tauri/commands";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ContentSearchState {
  query: string;
  caseSensitive: boolean;
  isRegex: boolean;
  results: ContentSearchResult | null;
  isSearching: boolean;
  error: string | null;
  /** @internal Monotonic counter to discard stale async results */
  _searchVersion: number;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface ContentSearchActions {
  setQuery: (query: string) => void;
  toggleCaseSensitive: () => void;
  toggleRegex: () => void;
  executeSearch: (projectPath: string) => Promise<void>;
  clearResults: () => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type ContentSearchStore = ContentSearchState & ContentSearchActions;

const initialState: ContentSearchState = {
  query: "",
  caseSensitive: false,
  isRegex: false,
  results: null,
  isSearching: false,
  error: null,
  _searchVersion: 0,
};

export const useContentSearchStore = create<ContentSearchStore>()((set, get) => ({
  ...initialState,

  setQuery: (query) =>
    set({ query, ...(query.trim() ? {} : { results: null, error: null }) }),

  toggleCaseSensitive: () =>
    set((s) => ({ caseSensitive: !s.caseSensitive })),

  toggleRegex: () =>
    set((s) => ({ isRegex: !s.isRegex })),

  executeSearch: async (projectPath) => {
    const { query, caseSensitive, isRegex } = get();
    if (!query.trim()) {
      set({ results: null, error: null });
      return;
    }

    const version = get()._searchVersion + 1;
    set({ isSearching: true, error: null, _searchVersion: version });
    try {
      const results = await searchFileContents(
        projectPath,
        query,
        caseSensitive,
        isRegex,
      );
      // Only apply if no newer search has been initiated
      if (get()._searchVersion === version) {
        set({ results, isSearching: false });
      }
    } catch (e) {
      if (get()._searchVersion === version) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("[ContentSearch] search failed:", e);
        set({ error: message, isSearching: false });
      }
    }
  },

  clearResults: () => set({ results: null, error: null, query: "", isSearching: false }),

  reset: () => set(initialState),
}));
