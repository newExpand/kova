import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { SessionInfo, TmuxPane } from "../types";
import * as commands from "../../../lib/tauri/commands";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface TmuxState {
  sessions: SessionInfo[];
  panes: Record<string, TmuxPane[]>;
  isAvailable: boolean | null;
  isLoading: boolean;
  isLoadingPanes: boolean;
  error: string | null;
  selectedSession: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface TmuxActions {
  checkAvailability: () => Promise<void>;
  fetchSessions: () => Promise<void>;
  registerSession: (projectId: string, sessionName: string) => Promise<void>;
  unregisterSession: (sessionName: string) => Promise<void>;
  selectSession: (name: string | null) => void;
  fetchPanes: (sessionName: string) => Promise<void>;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Combined Store Type
// ---------------------------------------------------------------------------

type TmuxStore = TmuxState & TmuxActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: TmuxState = {
  sessions: [],
  panes: {},
  isAvailable: null,
  isLoading: false,
  isLoadingPanes: false,
  error: null,
  selectedSession: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTmuxStore = create<TmuxStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      checkAvailability: async () => {
        try {
          const available = await commands.checkTmuxAvailable();
          set({ isAvailable: available }, undefined, "checkAvailability");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set(
            { isAvailable: false, error: message },
            undefined,
            "checkAvailability/error",
          );
        }
      },

      fetchSessions: async () => {
        set(
          { isLoading: true, error: null },
          undefined,
          "fetchSessions/start",
        );
        try {
          const sessions = await commands.listTmuxSessionsWithOwnership();
          set(
            { sessions, isLoading: false },
            undefined,
            "fetchSessions/success",
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set(
            { error: message, isLoading: false },
            undefined,
            "fetchSessions/error",
          );
        }
      },

      registerSession: async (projectId: string, sessionName: string) => {
        try {
          await commands.registerTmuxSession(projectId, sessionName);
          await get().fetchSessions();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set({ error: message }, undefined, "registerSession/error");
        }
      },

      unregisterSession: async (sessionName: string) => {
        try {
          await commands.unregisterTmuxSession(sessionName);
          await get().fetchSessions();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set({ error: message }, undefined, "unregisterSession/error");
        }
      },

      selectSession: (name) => {
        set({ selectedSession: name }, undefined, "selectSession");
        if (name && !get().panes[name]) {
          get().fetchPanes(name);
        }
      },

      fetchPanes: async (sessionName) => {
        set({ isLoadingPanes: true }, undefined, "fetchPanes/start");
        try {
          const paneList = await commands.listTmuxPanes(sessionName);
          set(
            (state) => ({
              panes: { ...state.panes, [sessionName]: paneList },
              isLoadingPanes: false,
            }),
            undefined,
            "fetchPanes/success",
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set(
            { error: message, isLoadingPanes: false },
            undefined,
            "fetchPanes/error",
          );
        }
      },

      reset: () => set(initialState, undefined, "reset"),
    }),
    { name: "TmuxStore" },
  ),
);
