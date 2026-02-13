// Re-export IPC types from commands layer
export type { NotificationRecord } from "../../lib/tauri/commands";
export type { HookEvent } from "../../lib/event-bridge/notification-events";

export type HookType =
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "SubagentStop"
  | "Unknown";

export function parseHookType(raw: string): HookType {
  switch (raw) {
    case "PreToolUse":
    case "PostToolUse":
    case "Stop":
    case "SubagentStop":
      return raw;
    default:
      return "Unknown";
  }
}
