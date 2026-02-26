import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import type { HookEvent } from "./notification-events";
import { setupNotificationClickEvents } from "./notification-events";
import { useNotificationStore } from "../../features/notification";
import { parseHookType } from "../../features/notification/types";
import { useAgentActivityStore, useGitStore } from "../../features/git";
import { useProjectStore } from "../../features/project";
import {
  useAgentFileTrackingStore,
  useFileStore,
  extractFilePath,
  resolveCanonicalFilePath,
} from "../../features/files";
import { useAppStore } from "../../stores/appStore";
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
  "Stop",
]);

// Tools whose PostToolUse events carry file_path for tracking
const FILE_TRACKING_TOOLS = new Set(["Read", "Edit", "Write"]);
const FILE_WRITE_TOOLS = new Set(["Edit", "Write"]);

// ---------------------------------------------------------------------------
// File tracking dispatch
// ---------------------------------------------------------------------------

function handleFileTracking(hookEvent: HookEvent): void {
  try {
    if (hookEvent.eventType !== "PostToolUse") return;

    const toolName = getPayloadString(hookEvent.payload, "tool_name");
    if (!toolName || !FILE_TRACKING_TOOLS.has(toolName)) return;

    // Extract tool_input object, then file_path from it
    const toolInput = getPayloadObject(hookEvent.payload, "tool_input");
    if (!toolInput) return;

    const absolutePath = extractFilePath(toolInput);
    if (!absolutePath) return;

    const projectPath = hookEvent.projectPath;
    if (!projectPath) return;

    const relativePath = resolveCanonicalFilePath(absolutePath, projectPath);
    if (!relativePath) return;

    const isWrite = FILE_WRITE_TOOLS.has(toolName);

    // 1. Track in agent file tracking store
    useAgentFileTrackingStore
      .getState()
      .trackFileTouch(projectPath, relativePath, toolName, isWrite);

    // 2. Auto-sync: open file in viewer when Edit/Write and panel is visible
    if (isWrite) {
      const isFileViewerOpen = useAppStore.getState().isFileViewerPanelOpen;
      if (isFileViewerOpen) {
        useFileStore
          .getState()
          .openFile(projectPath, relativePath)
          .catch((err) => {
            console.error("[event-bridge] Auto-sync openFile failed:", relativePath, err);
          });
      }
    }
  } catch (err) {
    console.error("[event-bridge] handleFileTracking failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Event bridge
// ---------------------------------------------------------------------------

let unlisteners: UnlistenFn[] = [];

export async function initEventBridge(): Promise<void> {
  // 단일 리스너: notification + agent activity + file tracking 모두 처리
  const hookUnlisten = await listen<Omit<HookEvent, "eventType"> & { eventType: string }>(
    "notification:hook-received",
    (event) => {
      // Parse raw string from Rust into typed HookType
      const hookEvent: HookEvent = {
        ...event.payload,
        eventType: parseHookType(event.payload.eventType),
      };

      // 1. Notification store (모든 이벤트)
      useNotificationStore.getState().pushRealtimeEvent(hookEvent);

      // 2. Agent activity store (해당 타입만)
      if (AGENT_ACTIVITY_TYPES.has(hookEvent.eventType)) {
        useAgentActivityStore.getState().pushActivity(hookEvent);
      }

      // 3. File tracking (PostToolUse + Read/Edit/Write)
      handleFileTracking(hookEvent);
    },
  );

  // worktree:ready — Rust 백그라운드 스레드에서 worktree 디렉토리 감지 시 emit
  const worktreeReadyUnlisten = await listen<{
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
  });

  // notification:clicked는 별도 리스너 유지
  const clickUnlisteners = await setupNotificationClickEvents();
  unlisteners.push(hookUnlisten, worktreeReadyUnlisten, ...clickUnlisteners);
}

export function destroyEventBridge(): void {
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
