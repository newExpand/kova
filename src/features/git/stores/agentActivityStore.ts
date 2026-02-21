import { create } from "zustand";
import type { HookEvent } from "../../../lib/event-bridge/notification-events";

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/** Normalize path key to reconcile canonical vs git worktree path differences */
export function normalizePathKey(path: string): string {
  let normalized = path.replace(/\/+$/, "");
  // macOS APFS firmlink: /System/Volumes/Data/Users → /Users
  if (normalized.startsWith("/System/Volumes/Data/")) {
    normalized = normalized.slice("/System/Volumes/Data".length);
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus = "loading" | "active" | "idle" | "done" | "error";

export interface AgentSessionState {
  projectPath: string;
  status: AgentStatus;
  toolUseCount: number;
  fileEditCount: number;
  commitCount: number;
  errorCount: number;
  subagentCount: number;
  isWaitingForInput: boolean;
  lastActivity: string;
  lastMessage: string | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface AgentActivityState {
  /** Active agent sessions keyed by projectPath */
  sessions: Record<string, AgentSessionState>;
  realtimeActivities: HookEvent[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface AgentActivityActions {
  pushActivity: (event: HookEvent) => void;
  getSessionForPath: (projectPath: string) => AgentSessionState | undefined;
  clearSession: (projectPath: string) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: AgentActivityState = {
  sessions: {},
  realtimeActivities: [],
};

const MAX_REALTIME_EVENTS = 100;
const DONE_AUTO_RESET_MS = 30_000; // 30s auto-reset after Done
const doneTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  Read: "Reading files",
  Edit: "Editing file",
  Write: "Writing file",
  Bash: "Running command",
  Grep: "Searching code",
  Glob: "Finding files",
  Task: "Running subtask",
  WebSearch: "Searching web",
  WebFetch: "Fetching page",
  Notebook: "Editing notebook",
};

function getToolDisplayName(toolName: string): string {
  if (TOOL_DISPLAY_NAMES[toolName]) return TOOL_DISPLAY_NAMES[toolName];
  if (toolName.startsWith("mcp__")) {
    const server = toolName.split("__")[1];
    return server ?? toolName;
  }
  return toolName;
}

function getPayloadString(
  payload: unknown,
  key: string,
): string | undefined {
  if (typeof payload === "object" && payload !== null) {
    const val = (payload as Record<string, unknown>)[key];
    return typeof val === "string" ? val : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAgentActivityStore = create<
  AgentActivityState & AgentActivityActions
>()((set, get) => ({
  ...initialState,

  getSessionForPath: (projectPath) =>
    get().sessions[normalizePathKey(projectPath)],

  clearSession: (projectPath) => {
    const key = normalizePathKey(projectPath);
    const timer = doneTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      doneTimers.delete(key);
    }
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[key];
      return { sessions };
    });
  },

  pushActivity: (event) => {
    const path = normalizePathKey(event.projectPath);
    // Cancel pending auto-reset on any new activity (not just SessionStart)
    const ACTIVITY_EVENTS = new Set([
      "SessionStart", "PostToolUse", "SubagentStart",
      "PostToolUseFailure", "TaskCompleted", "UserPromptSubmit",
    ]);
    if (ACTIVITY_EVENTS.has(event.eventType)) {
      const existing = doneTimers.get(path);
      if (existing) {
        clearTimeout(existing);
        doneTimers.delete(path);
      }
    }

    set((state) => {
      // Ring buffer for realtime events
      const realtimeActivities = [event, ...state.realtimeActivities].slice(
        0,
        MAX_REALTIME_EVENTS,
      );

      const sessions = { ...state.sessions };
      const now = new Date().toISOString();

      // Ensure session exists for any activity event (handles mid-session app restart)
      function ensureSession(): AgentSessionState {
        if (!sessions[path]) {
          sessions[path] = {
            projectPath: path,
            status: "active",
            toolUseCount: 0,
            fileEditCount: 0,
            commitCount: 0,
            errorCount: 0,
            subagentCount: 0,
            isWaitingForInput: false,
            lastActivity: now,
            lastMessage: null,
          };
        }
        return sessions[path];
      }

      switch (event.eventType) {
        case "UserPromptSubmit": {
          const session = ensureSession();
          session.status = "loading";
          session.isWaitingForInput = false;
          session.lastActivity = now;
          session.lastMessage = null;
          sessions[path] = { ...session };
          break;
        }

        case "PermissionRequest": {
          const session = ensureSession();
          session.isWaitingForInput = true;
          session.lastMessage = "Waiting for permission...";
          session.lastActivity = now;
          sessions[path] = { ...session };
          break;
        }

        case "SessionStart": {
          // Always reset to a fresh session (fixes stale "done" state)
          sessions[path] = {
            projectPath: path,
            status: "active",
            toolUseCount: 0,
            fileEditCount: 0,
            commitCount: 0,
            errorCount: 0,
            subagentCount: 0,
            isWaitingForInput: false,
            lastActivity: now,
            lastMessage: "Session started",
          };
          break;
        }

        case "PostToolUse": {
          const session = ensureSession();
          const toolName = getPayloadString(event.payload, "tool_name");
          const toolInput = getPayloadString(event.payload, "tool_input");

          session.status = "active";
          session.toolUseCount += 1;
          session.isWaitingForInput = false;
          session.lastActivity = now;

          if (toolName === "Write" || toolName === "Edit") {
            session.fileEditCount += 1;
          }
          if (
            toolName === "Bash" &&
            toolInput &&
            toolInput.includes("git commit")
          ) {
            session.commitCount += 1;
          }

          session.lastMessage = toolName ? getToolDisplayName(toolName) : null;
          sessions[path] = { ...session };
          break;
        }

        case "SubagentStart": {
          const session = ensureSession();
          session.status = "active";
          session.subagentCount += 1;
          session.lastActivity = now;
          sessions[path] = { ...session };
          break;
        }

        case "SubagentStop": {
          const session = ensureSession();
          session.subagentCount = Math.max(0, session.subagentCount - 1);
          session.lastActivity = now;
          sessions[path] = { ...session };
          break;
        }

        case "TaskCompleted": {
          const session = ensureSession();
          session.status = "active";
          const subject = getPayloadString(event.payload, "task_subject");
          session.lastMessage = subject ?? "Task completed";
          session.lastActivity = now;
          sessions[path] = { ...session };
          break;
        }

        case "PostToolUseFailure": {
          const session = ensureSession();
          session.status = "active";
          session.errorCount += 1;
          session.lastActivity = now;
          const errorMsg = getPayloadString(event.payload, "error");
          session.lastMessage = errorMsg
            ? `Error: ${errorMsg.slice(0, 60)}`
            : "Tool failed";
          sessions[path] = { ...session };
          break;
        }

        case "TeammateIdle": {
          const session = ensureSession();
          const teammateName = getPayloadString(event.payload, "teammate_name");
          session.lastMessage = teammateName
            ? `${teammateName} idle`
            : "Teammate idle";
          session.lastActivity = now;
          sessions[path] = { ...session };
          break;
        }

        case "Stop": {
          const session = ensureSession();
          session.status = "done";
          session.lastActivity = now;
          session.isWaitingForInput = false;
          const stopMsg = getPayloadString(event.payload, "message");
          if (stopMsg) {
            session.lastMessage = stopMsg;
          }
          sessions[path] = { ...session };
          break;
        }

        case "SessionEnd": {
          const session = ensureSession();
          session.status = "done";
          session.lastActivity = now;
          const endMsg = getPayloadString(event.payload, "message");
          if (endMsg) {
            session.lastMessage = endMsg;
          }
          sessions[path] = { ...session };
          break;
        }
      }

      return { sessions, realtimeActivities };
    });

    // Schedule auto-reset after SessionEnd or Stop (Claude Code sends Stop as final event)
    if (event.eventType === "SessionEnd" || event.eventType === "Stop") {
      const existing = doneTimers.get(path);
      if (existing) clearTimeout(existing);
      doneTimers.set(
        path,
        setTimeout(() => {
          doneTimers.delete(path);
          get().clearSession(path);
        }, DONE_AUTO_RESET_MS),
      );
    }
  },

  reset: () => {
    for (const timer of doneTimers.values()) clearTimeout(timer);
    doneTimers.clear();
    set(initialState);
  },
}));
