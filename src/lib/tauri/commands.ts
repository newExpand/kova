import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// IPC Types — match Rust structs with serde(rename_all = "camelCase")
// These will be re-exported from respective feature type files (T6, T15, T18).
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  path: string;
  colorIndex: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
  colorIndex?: number;
}

export interface UpdateProjectInput {
  name?: string;
  path?: string;
  colorIndex?: number;
}

export interface TmuxSession {
  name: string;
  windows: number;
  created: string;
  attached: boolean;
}

export interface TmuxPane {
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  paneTitle: string;
  paneCurrentCommand: string;
  paneActive: boolean;
}

export interface ProjectTmuxSession {
  id: string;
  projectId: string;
  sessionName: string;
  createdAt: string;
}

export interface SessionInfo {
  name: string;
  windows: number;
  created: string;
  attached: boolean;
  isAppSession: boolean;
  projectId: string | null;
}

export interface NotificationRecord {
  id: string;
  projectId: string;
  eventType: string;
  title: string;
  message: string | null;
  payload: string | null;
  createdAt: string;
}

export interface EnvironmentCheck {
  tmuxInstalled: boolean;
  tmuxVersion: string | null;
  claudeCodeInstalled: boolean;
  claudeCodeVersion: string | null;
  shellType: string;
}

// ---------------------------------------------------------------------------
// Project commands
// ---------------------------------------------------------------------------

export async function createProject(
  name: string,
  path: string,
  colorIndex: number,
): Promise<Project> {
  return invoke<Project>("create_project", { name, path, colorIndex });
}

export async function listProjects(): Promise<Project[]> {
  return invoke<Project[]>("list_projects");
}

export async function getProject(id: string): Promise<Project> {
  return invoke<Project>("get_project", { id });
}

export async function updateProject(
  id: string,
  input: UpdateProjectInput,
): Promise<Project> {
  return invoke<Project>("update_project", { id, input });
}

export async function deleteProject(id: string): Promise<void> {
  return invoke<void>("delete_project", { id });
}

export async function restoreProject(id: string): Promise<void> {
  return invoke<void>("restore_project", { id });
}

export async function purgeProject(id: string): Promise<void> {
  return invoke<void>("purge_project", { id });
}

// ---------------------------------------------------------------------------
// Hook commands
// ---------------------------------------------------------------------------

export async function injectProjectHooks(projectPath: string): Promise<void> {
  return invoke<void>("inject_project_hooks", { projectPath });
}

export async function removeProjectHooks(projectPath: string): Promise<void> {
  return invoke<void>("remove_project_hooks", { projectPath });
}

// ---------------------------------------------------------------------------
// tmux commands
// ---------------------------------------------------------------------------

export async function checkTmuxAvailable(): Promise<boolean> {
  return invoke<boolean>("check_tmux_available");
}

export async function listTmuxSessions(): Promise<TmuxSession[]> {
  return invoke<TmuxSession[]>("list_tmux_sessions");
}

export async function listTmuxPanes(sessionName: string): Promise<TmuxPane[]> {
  return invoke<TmuxPane[]>("list_tmux_panes", { sessionName });
}

export async function createTmuxSession(
  name: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke<void>("create_tmux_session", { name, cols, rows });
}

export async function killTmuxSession(name: string): Promise<void> {
  return invoke<void>("kill_tmux_session", { name });
}

export async function registerTmuxSession(
  projectId: string,
  sessionName: string,
): Promise<SessionInfo[]> {
  return invoke<SessionInfo[]>("register_tmux_session", {
    projectId,
    sessionName,
  });
}

export async function unregisterTmuxSession(
  sessionName: string,
): Promise<SessionInfo[]> {
  return invoke<SessionInfo[]>("unregister_tmux_session", { sessionName });
}

export async function listTmuxSessionsWithOwnership(): Promise<SessionInfo[]> {
  return invoke<SessionInfo[]>("list_tmux_sessions_with_ownership");
}

// ---------------------------------------------------------------------------
// Notification commands
// ---------------------------------------------------------------------------

export async function listProjectNotifications(
  projectId: string,
  limit?: number,
): Promise<NotificationRecord[]> {
  return invoke<NotificationRecord[]>("list_project_notifications", {
    projectId,
    limit,
  });
}

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

export interface AppSetting {
  key: string;
  value: string;
  updatedAt: string;
}

export async function getSetting(
  key: string,
  defaultValue: string,
): Promise<string> {
  return invoke<string>("get_setting", { key, default: defaultValue });
}

export async function setSetting(
  key: string,
  value: string,
): Promise<void> {
  return invoke<void>("set_setting", { key, value });
}

export async function listSettings(): Promise<AppSetting[]> {
  return invoke<AppSetting[]>("list_settings");
}

// ---------------------------------------------------------------------------
// Environment commands
// ---------------------------------------------------------------------------

export async function checkEnvironment(): Promise<EnvironmentCheck> {
  return invoke<EnvironmentCheck>("check_environment");
}
