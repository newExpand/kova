// Re-export IPC types from commands layer
export type {
  TmuxSession,
  TmuxPane,
  ProjectTmuxSession,
  SessionInfo,
  KillFailure,
  KillAllResult,
} from "../../lib/tauri/commands";
