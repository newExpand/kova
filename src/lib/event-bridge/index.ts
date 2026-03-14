import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import type { HookEvent } from "./notification-events";
import { setupNotificationClickEvents } from "./notification-events";
import { useNotificationStore } from "../../features/notification";
import { parseHookType } from "../../features/notification/types";
import { useAgentActivityStore, useGitStore, toProjectPathKey } from "../../features/git";
import { useProjectStore } from "../../features/project";
import {
  useAgentFileTrackingStore,
  extractFilePath,
  resolveCanonicalFilePath,
} from "../../features/files";
import { getPayloadString, getPayloadObject } from "../payload-helpers";

// Superset of Rust AGENT_ACTIVITY_TYPES in event_server.rs.
// Includes UserPromptSubmit, PermissionRequest, Stop for frontend-only realtime UX.
const AGENT_ACTIVITY_TYPES = new Set([
  "UserPromptSubmit",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "TaskCompleted",
  "TeammateIdle",
  "SessionStart",
  "SessionEnd",
  "AgentActive",
  "AgentIdle",
  "Stop",
]);

// Tools whose PostToolUse events carry file_path for tracking
const FILE_WRITE_TOOLS = new Set(["Edit", "Write"]);

// ---------------------------------------------------------------------------
// File tracking dispatch
// ---------------------------------------------------------------------------

function handleFileTracking(hookEvent: HookEvent): void {
  try {
    if (hookEvent.eventType !== "PostToolUse") return;

    const toolName = getPayloadString(hookEvent.payload, "tool_name");
    if (!toolName || !FILE_WRITE_TOOLS.has(toolName)) return;

    // Extract tool_input object, then file_path from it
    const toolInput = getPayloadObject(hookEvent.payload, "tool_input");
    if (!toolInput) return;

    const absolutePath = extractFilePath(toolInput);
    if (!absolutePath) return;

    const projectPath = hookEvent.projectPath;
    if (!projectPath) return;

    const relativePath = resolveCanonicalFilePath(absolutePath, projectPath);
    if (!relativePath) return;

    // Track in agent file tracking store (Working Set "AI Edits")
    useAgentFileTrackingStore
      .getState()
      .trackAgentWrite(projectPath, relativePath, toolName);
  } catch (err) {
    console.error(
      "[event-bridge] handleFileTracking failed for event:",
      hookEvent.eventType,
      "tool:",
      getPayloadString(hookEvent.payload, "tool_name") ?? "unknown",
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// Event bridge
// ---------------------------------------------------------------------------

let unlisteners: UnlistenFn[] = [];
let generation = 0;

export async function initEventBridge(): Promise<void> {
  const currentGen = ++generation;

  // Register all 4 listeners in parallel
  const [hookUnlisten, worktreeReadyUnlisten, alerterFallbackUnlisten, clickUnlisteners] =
    await Promise.all([
      // Single listener: handles notification + agent activity + file tracking
      listen<Omit<HookEvent, "eventType"> & { eventType: string }>(
        "notification:hook-received",
        (event) => {
          // Parse raw string from Rust into typed HookType
          const hookEvent: HookEvent = {
            ...event.payload,
            eventType: parseHookType(event.payload.eventType),
          };

          // 1. Notification store (all events)
          useNotificationStore.getState().pushRealtimeEvent(hookEvent);

          // 2. Agent activity store (matching types only)
          if (AGENT_ACTIVITY_TYPES.has(hookEvent.eventType)) {
            useAgentActivityStore.getState().pushActivity(hookEvent);
          }

          // 3. File tracking (PostToolUse + Read/Edit/Write)
          handleFileTracking(hookEvent);

          // 4. Reconcile working set on agent session end
          if (hookEvent.eventType === "Stop" || hookEvent.eventType === "SessionEnd") {
            try {
              if (hookEvent.projectPath) {
                const rootPath = toProjectPathKey(hookEvent.projectPath);
                const eventGen = generation;
                setTimeout(() => {
                  // Skip if bridge was destroyed/re-initialized since this event
                  if (eventGen !== generation) return;
                  useAgentFileTrackingStore
                    .getState()
                    .reconcileNow(rootPath)
                    .catch((err: unknown) =>
                      console.error("[event-bridge] deferred reconcileNow failed:", err),
                    );
                }, 1000);
              }
            } catch (err) {
              console.error("[event-bridge] reconciliation dispatch failed:", err);
            }
          }
        },
      ),

      // worktree:ready — emitted when Rust background thread detects a worktree directory
      listen<{
        projectPath: string;
        taskName: string;
        worktreePath: string;
      }>("worktree:ready", (event) => {
        const { projectPath } = event.payload;
        const projects = useProjectStore.getState().projects;
        const match = projects.find((p) => p.path === projectPath);
        if (match) {
          useGitStore.getState().fetchGraphData(match.id, projectPath);
        } else {
          console.warn(
            "[event-bridge] worktree:ready — no project match for path:",
            projectPath,
            "Known paths:",
            projects.map((p) => p.path),
          );
        }
      }),

      // alerter-fallback — once per session, show install hint
      listen("notification:alerter-fallback", () => {
        useNotificationStore.getState().showAlerterFallbackWarning();
      }),

      // notification:clicked keeps a separate listener
      setupNotificationClickEvents(),
    ]);

  // If a newer init or destroy was called while we awaited, discard these listeners
  if (currentGen !== generation) {
    hookUnlisten();
    worktreeReadyUnlisten();
    alerterFallbackUnlisten();
    for (const fn of clickUnlisteners) {
      fn();
    }
    return;
  }

  unlisteners.push(hookUnlisten, worktreeReadyUnlisten, alerterFallbackUnlisten, ...clickUnlisteners);
}

export function destroyEventBridge(): void {
  // Increment generation to invalidate any in-flight init
  generation++;
  for (const fn of unlisteners) {
    fn();
  }
  unlisteners = [];
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    destroyEventBridge();
  });
  import.meta.hot.accept(() => {
    initEventBridge().catch((e) => {
      console.error("[event-bridge] HMR re-init failed:", e);
    });
  });
}
