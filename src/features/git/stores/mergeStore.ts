import { create } from "zustand";
import type { MergeToMainResult, RebaseStatusResult } from "../../../lib/tauri/commands";
import {
  mergeWorktreeToMain,
  completeMergeToMain,
  abortMergeRebase,
  checkRebaseStatus,
  sendKeysToTmuxWindowDelayed,
} from "../../../lib/tauri/commands";
import { useAgentActivityStore, normalizePathKey } from "./agentActivityStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MergeStatus =
  | "idle"
  | "confirming"
  | "dirty"
  | "rebasing"
  | "conflicts"
  | "waitingForAgent"
  | "waitingForClaude"
  | "completing"
  | "success"
  | "error";

interface AgentRef {
  sessionName: string;
  taskName: string;
}

interface MergeContext {
  repoPath: string;
  worktreePath: string;
  branchName: string;
  agent: AgentRef | null;
  /** Number of uncommitted changes (staged + unstaged + untracked). 0 = clean. */
  dirtyCount: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface MergeState {
  status: MergeStatus;
  context: MergeContext | null;
  conflictDetails: string | null;
  result: MergeToMainResult | null;
  errorMessage: string | null;
  dirtyFileCount: number | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface MergeActions {
  requestMerge: (ctx: MergeContext) => void;
  startMerge: () => Promise<void>;
  sendConflictPromptToClaude: () => Promise<boolean>;
  pollRebaseStatus: () => Promise<RebaseStatusResult | null>;
  attemptCompletion: () => Promise<void>;
  abortMerge: () => Promise<void>;
  onAgentStopDetected: () => void;
  dismiss: () => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: MergeState = {
  status: "idle",
  context: null,
  conflictDetails: null,
  result: null,
  errorMessage: null,
  dirtyFileCount: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFLICT_PROMPT =
  "The rebase onto main has merge conflicts. Please resolve all merge conflicts in the affected files, then stage the resolved files with git add and run git rebase --continue.";

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Check if the Claude Code agent for a worktree is idle (can accept prompts). */
function isAgentIdle(worktreePath: string): "idle" | "busy" | "none" {
  const key = normalizePathKey(worktreePath);
  const session = useAgentActivityStore.getState().sessions[key];
  if (!session) return "none";
  if (session.status === "done" || session.status === "idle" || session.status === "ready") {
    return "idle";
  }
  return "busy";
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useMergeStore = create<MergeState & MergeActions>()((set, get) => ({
  ...initialState,

  requestMerge: (ctx) => {
    set({ ...initialState, status: "confirming", context: ctx });
  },

  startMerge: async () => {
    const { context } = get();
    if (!context) return;

    // Fast path: if frontend already knows it's dirty, skip the backend call
    if (context.dirtyCount > 0) {
      set({ status: "dirty", dirtyFileCount: context.dirtyCount });
      return;
    }

    set({ status: "rebasing", errorMessage: null, dirtyFileCount: null });

    try {
      const result = await mergeWorktreeToMain(
        context.repoPath,
        context.worktreePath,
        context.branchName,
        context.agent?.sessionName ?? null,
      );

      if (result.status === "success") {
        set({ status: "success", result });
      } else if (result.status === "dirtyWorktree") {
        set({ status: "dirty", dirtyFileCount: result.dirtyFileCount });
      } else if (result.status === "conflictsDetected") {
        set({ status: "conflicts", conflictDetails: result.conflictDetails });
      } else {
        console.error("[mergeStore] Unknown merge status:", result.status);
        set({ status: "error", errorMessage: `Unexpected merge status: ${result.status}` });
      }
    } catch (e) {
      set({ status: "error", errorMessage: toErrorMessage(e) });
    }
  },

  sendConflictPromptToClaude: async () => {
    const { context } = get();
    if (!context?.agent) {
      console.warn("[mergeStore] No agent in context:", context);
      set({ errorMessage: "No Claude session found for this worktree. Use the terminal to resolve manually." });
      return false;
    }

    const agentState = isAgentIdle(context.worktreePath);
    console.log("[mergeStore] sendConflictPromptToClaude:", {
      sessionName: context.agent.sessionName,
      taskName: context.agent.taskName,
      worktreePath: context.worktreePath,
      agentState,
    });

    if (agentState === "busy") {
      // Agent is actively working — wait for Stop event, then auto-send
      set({ status: "waitingForAgent", errorMessage: null });
      return true;
    }

    // "idle" or "none" (no tracking data, but Claude may still be running) — send optimistically
    try {
      await sendKeysToTmuxWindowDelayed(
        context.agent.sessionName,
        context.agent.taskName,
        CONFLICT_PROMPT,
      );
      set({ status: "waitingForClaude", errorMessage: null });
      return true;
    } catch (e) {
      console.error("[mergeStore] Failed to send keys to Claude:", e);
      set({ errorMessage: `Failed to send prompt to Claude: ${toErrorMessage(e)}` });
      return false;
    }
  },

  pollRebaseStatus: async () => {
    const { context } = get();
    if (!context) return null;
    try {
      return await checkRebaseStatus(context.worktreePath);
    } catch (e) {
      console.error("[mergeStore] Failed to check rebase status:", e);
      return null;
    }
  },

  attemptCompletion: async () => {
    const { context } = get();
    if (!context) return;

    try {
      const rebaseStatus = await get().pollRebaseStatus();
      if (rebaseStatus?.inProgress) {
        set({
          status: "conflicts",
          errorMessage: "Rebase is still in progress. Conflicts may not be fully resolved.",
        });
        return;
      }
    } catch (e) {
      set({ status: "error", errorMessage: `Cannot verify rebase status: ${toErrorMessage(e)}` });
      return;
    }

    set({ status: "completing", errorMessage: null });

    try {
      const result = await completeMergeToMain(
        context.repoPath,
        context.worktreePath,
        context.branchName,
        context.agent?.sessionName ?? null,
      );
      set({ status: "success", result });
    } catch (e) {
      set({ status: "error", errorMessage: toErrorMessage(e) });
    }
  },

  abortMerge: async () => {
    const { context } = get();
    if (!context) return;

    try {
      await abortMergeRebase(context.worktreePath);
      set(initialState);
    } catch (e) {
      set({ status: "error", errorMessage: `Abort failed: ${toErrorMessage(e)}` });
    }
  },

  onAgentStopDetected: () => {
    const { status, context } = get();
    if (!context) return;

    if (status === "waitingForAgent") {
      // Agent was busy, now idle — send the conflict prompt
      if (!context.agent) return;
      sendKeysToTmuxWindowDelayed(context.agent.sessionName, context.agent.taskName, CONFLICT_PROMPT)
        .then(() => set({ status: "waitingForClaude" }))
        .catch((e) => {
          console.error("[mergeStore] Failed to send prompt after agent stop:", e);
          set({ status: "conflicts", errorMessage: "Failed to send prompt to Claude." });
        });
    } else if (status === "waitingForClaude") {
      // Claude finished resolving — attempt completion
      get().attemptCompletion().catch((e) => {
        console.error("[mergeStore] attemptCompletion failed after agent stop:", e);
        set({ status: "error", errorMessage: `Merge completion failed: ${toErrorMessage(e)}` });
      });
    }
  },

  dismiss: () => set(initialState),
  reset: () => set(initialState),
}));
