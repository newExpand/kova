import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import type { HookEvent } from "./notification-events";
import { setupNotificationClickEvents } from "./notification-events";
import { useNotificationStore } from "../../features/notification";
import { parseHookType } from "../../features/notification/types";
import { useAgentActivityStore, useGitStore } from "../../features/git";
import { useProjectStore } from "../../features/project";

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

let unlisteners: UnlistenFn[] = [];

export async function initEventBridge(): Promise<void> {
  // 단일 리스너: notification + agent activity 모두 처리
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
