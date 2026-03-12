// Re-export IPC types from commands layer
export type { NotificationRecord } from "../../lib/tauri/commands";
export type { HookEvent } from "../../lib/event-bridge/notification-events";

export type HookType =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Stop"
  | "SubagentStop"
  | "SubagentStart"
  | "TaskCompleted"
  | "TeammateIdle"
  | "Notification"
  | "SessionStart"
  | "SessionEnd"
  | "AgentActive"
  | "AgentIdle"
  | "PermissionRequest"
  | "UserPromptSubmit"
  | "ConfigChange"
  | "PreCompact"
  | "Unknown";

export function parseHookType(raw: string): HookType {
  switch (raw) {
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "Stop":
    case "SubagentStop":
    case "SubagentStart":
    case "TaskCompleted":
    case "TeammateIdle":
    case "Notification":
    case "SessionStart":
    case "SessionEnd":
    case "AgentActive":
    case "AgentIdle":
    case "PermissionRequest":
    case "UserPromptSubmit":
    case "ConfigChange":
    case "PreCompact":
      return raw;
    default:
      return "Unknown";
  }
}
