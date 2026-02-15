import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { TerminalStatus } from "../types";

// ---------------------------------------------------------------------------
// Per-project instance state
// ---------------------------------------------------------------------------

interface TerminalInstanceState {
  sessionName: string | null;
  status: TerminalStatus;
  error: string | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface TerminalState {
  terminals: Record<string, TerminalInstanceState>;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface TerminalActions {
  setSession: (projectId: string, name: string) => void;
  setStatus: (projectId: string, status: TerminalStatus) => void;
  setError: (projectId: string, error: string) => void;
  getTerminal: (projectId: string) => TerminalInstanceState;
  resetTerminal: (projectId: string) => void;
  resetAll: () => void;
}

// ---------------------------------------------------------------------------
// Combined Store Type
// ---------------------------------------------------------------------------

type TerminalStore = TerminalState & TerminalActions;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const defaultInstance: TerminalInstanceState = {
  sessionName: null,
  status: "idle",
  error: null,
};

const initialState: TerminalState = {
  terminals: {},
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTerminalStore = create<TerminalStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setSession: (projectId, name) =>
        set(
          (state) => ({
            terminals: {
              ...state.terminals,
              [projectId]: {
                ...(state.terminals[projectId] ?? defaultInstance),
                sessionName: name,
                error: null,
              },
            },
          }),
          undefined,
          "setSession",
        ),

      setStatus: (projectId, status) =>
        set(
          (state) => ({
            terminals: {
              ...state.terminals,
              [projectId]: {
                ...(state.terminals[projectId] ?? defaultInstance),
                status,
              },
            },
          }),
          undefined,
          "setStatus",
        ),

      setError: (projectId, error) =>
        set(
          (state) => ({
            terminals: {
              ...state.terminals,
              [projectId]: {
                ...(state.terminals[projectId] ?? defaultInstance),
                error,
                status: "error" as TerminalStatus,
              },
            },
          }),
          undefined,
          "setError",
        ),

      getTerminal: (projectId) =>
        get().terminals[projectId] ?? defaultInstance,

      resetTerminal: (projectId) =>
        set(
          (state) => {
            const next = { ...state.terminals };
            delete next[projectId];
            return { terminals: next };
          },
          undefined,
          "resetTerminal",
        ),

      resetAll: () => set(initialState, undefined, "resetAll"),
    }),
    { name: "TerminalStore" },
  ),
);
