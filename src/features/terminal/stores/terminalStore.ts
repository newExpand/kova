import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { TerminalStatus } from "../types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface TerminalState {
  sessionName: string | null;
  status: TerminalStatus;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface TerminalActions {
  setSession: (name: string) => void;
  setStatus: (status: TerminalStatus) => void;
  setError: (error: string) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Combined Store Type
// ---------------------------------------------------------------------------

type TerminalStore = TerminalState & TerminalActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: TerminalState = {
  sessionName: null,
  status: "idle",
  error: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTerminalStore = create<TerminalStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setSession: (name) =>
        set({ sessionName: name, error: null }, undefined, "setSession"),

      setStatus: (status) =>
        set({ status }, undefined, "setStatus"),

      setError: (error) =>
        set({ error, status: "error" }, undefined, "setError"),

      reset: () => set(initialState, undefined, "reset"),
    }),
    { name: "TerminalStore" },
  ),
);
