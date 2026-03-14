import { create } from "zustand";
import type { HookEvent } from "../../../lib/event-bridge/notification-events";
import type { AgentType } from "../../../lib/tauri/commands";
import { getPayloadString } from "../../../lib/payload-helpers";

/** Map snake_case DB agent type strings to camelCase AgentType union values. */
const AGENT_DB_TO_IPC: Record<string, AgentType> = {
  claude_code: "claudeCode",
  codex_cli: "codexCli",
  gemini_cli: "geminiCli",
};

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/** Normalize path key — preserves worktree identity for hook-driven sessions. */
export function normalizePathKey(path: string): string {
  let normalized = path.replace(/\/+$/, "");
  // macOS APFS firmlink: /System/Volumes/Data/Users → /Users
  if (normalized.startsWith("/System/Volumes/Data/")) {
    normalized = normalized.slice("/System/Volumes/Data".length);
  }
  return normalized;
}

/** Extract the parent project path from a worktree path.
 *  e.g. "/project/.claude/worktrees/task" → "/project"
 *  Returns the original path if it is not a worktree path. */
export function toProjectPathKey(path: string): string {
  const normalized = normalizePathKey(path);
  const idx = normalized.indexOf("/.claude/worktrees/");
  return idx !== -1 ? normalized.slice(0, idx) : normalized;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus = "loading" | "active" | "idle" | "done" | "error" | "ready";

export interface AgentSessionState {
  sessionKey: string;
  projectPath: string;
  projectRootPath: string;
  status: AgentStatus;
  toolUseCount: number;
  fileEditCount: number;
  commitCount: number;
  errorCount: number;
  subagentCount: number;
  isWaitingForInput: boolean;
  lastActivity: string;
  lastMessage: string | null;
  /** Runtime-detected or hook-declared agent type (camelCase preferred). */
  detectedAgentType?: string;
  source?: "hook" | "synthetic";
  sessionName?: string;
  windowName?: string;
  paneId?: string;
  paneIndex?: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface AgentActivityState {
  /** Active agent sessions keyed by hook path or synthetic instance_key */
  sessions: Record<string, AgentSessionState>;
  realtimeActivities: HookEvent[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface AgentActivityActions {
  pushActivity: (event: HookEvent) => void;
  getSessionForPath: (projectPath: string) => AgentSessionState | undefined;
  /** Find the most representative session for a project, including worktrees and synthetic panes. */
  getProjectSession: (projectPath: string) => AgentSessionState | undefined;
  clearSession: (sessionKey: string) => void;
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
const LOADING_TIMEOUT_MS = 15_000; // 15s: ESC during thinking won't fire Stop hook
const MAX_SESSION_STALE_MS = 4 * 60 * 60 * 1000; // 4 hours
const EVICTION_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastEvictionCheck = 0;
const doneTimers = new Map<string, ReturnType<typeof setTimeout>>();
const loadingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Clear and remove a timer from the given map. No-op if the key is absent. */
function clearTimer(map: Map<string, ReturnType<typeof setTimeout>>, key: string): void {
  const timer = map.get(key);
  if (timer) {
    clearTimeout(timer);
    map.delete(key);
  }
}

/** Evict orphaned sessions that have been stale for over MAX_SESSION_STALE_MS.
 *  Runs at most once every EVICTION_CHECK_INTERVAL_MS (throttled via lastEvictionCheck). */
function evictStaleSessions(sessions: Record<string, AgentSessionState>): Record<string, AgentSessionState> | null {
  const now = Date.now();
  if (now - lastEvictionCheck < EVICTION_CHECK_INTERVAL_MS) return null;
  lastEvictionCheck = now;

  const keysToEvict: string[] = [];
  for (const [key, session] of Object.entries(sessions)) {
    if (session.status === "done") continue; // done sessions have their own 30s auto-cleanup
    if (now - new Date(session.lastActivity).getTime() > MAX_SESSION_STALE_MS) {
      keysToEvict.push(key);
    }
  }

  if (keysToEvict.length === 0) return null;

  const updated = { ...sessions };
  for (const key of keysToEvict) {
    clearTimer(doneTimers, key);
    clearTimer(loadingTimers, key);
    delete updated[key];
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Status priority for project-level aggregation: lower = busier. */
const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  loading: 0,
  ready: 2,
  idle: 3,
  done: 4,
  error: 5,
};

const ACTIVITY_EVENTS = new Set([
  "SessionStart",
  "PostToolUse",
  "SubagentStart",
  "PostToolUseFailure",
  "TaskCompleted",
  "UserPromptSubmit",
  "AgentActive",
  "AgentIdle",
]);

/** Returns true if `a` is busier (or equally busy but more recent) than `b`. */
function sessionBusier(a: AgentSessionState, b: AgentSessionState): boolean {
  const pa = (a.isWaitingForInput ? 1 : STATUS_PRIORITY[a.status]) ?? 5;
  const pb = (b.isWaitingForInput ? 1 : STATUS_PRIORITY[b.status]) ?? 5;
  if (pa !== pb) return pa < pb;
  return a.lastActivity > b.lastActivity;
}

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

function normalizeAgentType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return AGENT_DB_TO_IPC[raw] ?? raw;
}

function getEventAgentType(event: HookEvent): string | undefined {
  const fromPayload = normalizeAgentType(getPayloadString(event.payload, "agent_type"));
  if (fromPayload) return fromPayload;

  const match = normalizePathKey(event.projectPath).match(/\/\.agent\/([^/]+)(?:\/|$)/);
  return normalizeAgentType(match?.[1]);
}

function getEventSessionKey(event: HookEvent): string {
  return getPayloadString(event.payload, "instance_key") ?? normalizePathKey(event.projectPath);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAgentActivityStore = create<
  AgentActivityState & AgentActivityActions
>()((set, get) => ({
  ...initialState,

  getSessionForPath: (projectPath) => {
    const pathKey = normalizePathKey(projectPath);
    let best: AgentSessionState | undefined;
    for (const session of Object.values(get().sessions)) {
      if (session.projectPath !== pathKey) continue;
      if (!best || sessionBusier(session, best)) {
        best = session;
      }
    }
    return best;
  },

  getProjectSession: (projectPath) => {
    const projectKey = normalizePathKey(projectPath);
    let best: AgentSessionState | undefined;
    for (const session of Object.values(get().sessions)) {
      if (session.projectRootPath !== projectKey) continue;
      if (!best || sessionBusier(session, best)) {
        best = session;
      }
    }
    return best;
  },

  clearSession: (sessionKey) => {
    clearTimer(doneTimers, sessionKey);
    clearTimer(loadingTimers, sessionKey);
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[sessionKey];
      return { sessions };
    });
  },

  pushActivity: (event) => {
    const sessionKey = getEventSessionKey(event);
    const projectPath = normalizePathKey(event.projectPath);
    const projectRootPath = toProjectPathKey(projectPath);
    const detectedAgentType = getEventAgentType(event);
    const source = getPayloadString(event.payload, "source") === "synthetic"
      ? "synthetic"
      : "hook";

    if (ACTIVITY_EVENTS.has(event.eventType)) {
      clearTimer(doneTimers, sessionKey);
      clearTimer(loadingTimers, sessionKey);
    }

    set((state) => {
      const realtimeActivities = [event, ...state.realtimeActivities].slice(
        0,
        MAX_REALTIME_EVENTS,
      );

      const sessions = { ...state.sessions };
      const now = new Date().toISOString();

      function ensureSession(): AgentSessionState {
        if (!sessions[sessionKey]) {
          sessions[sessionKey] = {
            sessionKey,
            projectPath,
            projectRootPath,
            status: "active",
            toolUseCount: 0,
            fileEditCount: 0,
            commitCount: 0,
            errorCount: 0,
            subagentCount: 0,
            isWaitingForInput: false,
            lastActivity: now,
            lastMessage: null,
            detectedAgentType: detectedAgentType ?? "claudeCode",
            source,
            sessionName: getPayloadString(event.payload, "session_name"),
            windowName: getPayloadString(event.payload, "window_name"),
            paneId: getPayloadString(event.payload, "pane_id"),
            paneIndex: getPayloadString(event.payload, "pane_index"),
          };
        } else {
          sessions[sessionKey] = {
            ...sessions[sessionKey],
            projectPath,
            projectRootPath,
            detectedAgentType: detectedAgentType ?? sessions[sessionKey].detectedAgentType,
            source,
            sessionName: getPayloadString(event.payload, "session_name") ?? sessions[sessionKey].sessionName,
            windowName: getPayloadString(event.payload, "window_name") ?? sessions[sessionKey].windowName,
            paneId: getPayloadString(event.payload, "pane_id") ?? sessions[sessionKey].paneId,
            paneIndex: getPayloadString(event.payload, "pane_index") ?? sessions[sessionKey].paneIndex,
          };
        }
        return sessions[sessionKey];
      }

      switch (event.eventType) {
        case "UserPromptSubmit": {
          const session = ensureSession();
          session.status = "loading";
          session.isWaitingForInput = false;
          session.lastActivity = now;
          session.lastMessage = null;
          sessions[sessionKey] = { ...session };
          break;
        }

        case "PermissionRequest": {
          const session = ensureSession();
          session.isWaitingForInput = true;
          session.lastMessage = "Waiting for permission...";
          session.lastActivity = now;
          sessions[sessionKey] = { ...session };
          break;
        }

        case "SessionStart": {
          // Both hook and synthetic sessions start as "ready".
          // Synthetic transitions to "active" on first AgentActive, then "idle" on AgentIdle.
          sessions[sessionKey] = {
            sessionKey,
            projectPath,
            projectRootPath,
            status: "ready",
            toolUseCount: 0,
            fileEditCount: 0,
            commitCount: 0,
            errorCount: 0,
            subagentCount: 0,
            isWaitingForInput: false,
            lastActivity: now,
            lastMessage: getPayloadString(event.payload, "message") ?? "Session started",
            detectedAgentType: detectedAgentType ?? "claudeCode",
            source,
            sessionName: getPayloadString(event.payload, "session_name"),
            windowName: getPayloadString(event.payload, "window_name"),
            paneId: getPayloadString(event.payload, "pane_id"),
            paneIndex: getPayloadString(event.payload, "pane_index"),
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
          if (toolName === "Bash" && toolInput && toolInput.includes("git commit")) {
            session.commitCount += 1;
          }

          session.lastMessage = toolName ? getToolDisplayName(toolName) : null;
          sessions[sessionKey] = { ...session };
          break;
        }

        case "SubagentStart": {
          const session = ensureSession();
          session.status = "active";
          session.subagentCount += 1;
          session.lastActivity = now;
          sessions[sessionKey] = { ...session };
          break;
        }

        case "SubagentStop": {
          const session = ensureSession();
          session.subagentCount = Math.max(0, session.subagentCount - 1);
          session.lastActivity = now;
          sessions[sessionKey] = { ...session };
          break;
        }

        case "TaskCompleted": {
          const session = ensureSession();
          session.status = "active";
          const subject = getPayloadString(event.payload, "task_subject");
          session.lastMessage = subject ?? "Task completed";
          session.lastActivity = now;
          sessions[sessionKey] = { ...session };
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
          sessions[sessionKey] = { ...session };
          break;
        }

        case "TeammateIdle": {
          const session = ensureSession();
          const teammateName = getPayloadString(event.payload, "teammate_name");
          session.lastMessage = teammateName
            ? `${teammateName} idle`
            : "Teammate idle";
          session.lastActivity = now;
          sessions[sessionKey] = { ...session };
          break;
        }

        case "AgentActive": {
          const session = ensureSession();
          session.status = "active";
          session.lastActivity = now;
          session.lastMessage = getPayloadString(event.payload, "message") ?? "Working...";
          sessions[sessionKey] = { ...session };
          break;
        }

        case "AgentIdle": {
          const session = ensureSession();
          session.status = "idle";
          session.lastActivity = now;
          session.lastMessage = getPayloadString(event.payload, "message") ?? "Idle";
          sessions[sessionKey] = { ...session };
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
          sessions[sessionKey] = { ...session };
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
          sessions[sessionKey] = { ...session };
          break;
        }

        default: {
          if (import.meta.env.DEV) {
            console.warn(`[AgentActivity] Unhandled event type: ${event.eventType}`);
          }
          break;
        }
      }

      // Evict orphaned sessions that crashed without Stop/SessionEnd
      const evicted = evictStaleSessions(sessions);

      return { sessions: evicted ?? sessions, realtimeActivities };
    });

    if (event.eventType === "SessionEnd" || event.eventType === "Stop") {
      clearTimer(doneTimers, sessionKey);
      doneTimers.set(
        sessionKey,
        setTimeout(() => {
          doneTimers.delete(sessionKey);
          get().clearSession(sessionKey);
        }, DONE_AUTO_RESET_MS),
      );
    }

    // Loading timeout: ESC during thinking won't fire Stop hook,
    // so auto-transition to "idle" after 15s of uninterrupted "loading".
    if (event.eventType === "UserPromptSubmit") {
      clearTimer(loadingTimers, sessionKey);
      loadingTimers.set(
        sessionKey,
        setTimeout(() => {
          loadingTimers.delete(sessionKey);
          const current = get().sessions[sessionKey];
          if (current && current.status === "loading") {
            set((state) => {
              const session = state.sessions[sessionKey];
              if (!session) return state;
              return {
                sessions: {
                  ...state.sessions,
                  [sessionKey]: {
                    ...session,
                    status: "idle" as const,
                    lastMessage: null,
                    lastActivity: new Date().toISOString(),
                  },
                },
              };
            });
          }
        }, LOADING_TIMEOUT_MS),
      );
    }
  },

  reset: () => {
    for (const timer of doneTimers.values()) clearTimeout(timer);
    doneTimers.clear();
    for (const timer of loadingTimers.values()) clearTimeout(timer);
    loadingTimers.clear();
    lastEvictionCheck = 0;
    set(initialState);
  },
}));
