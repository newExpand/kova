import { invoke, convertFileSrc } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// IPC Types — match Rust structs with serde(rename_all = "camelCase")
// These will be re-exported from respective feature type files (T6, T15, T18).
// ---------------------------------------------------------------------------

export type AgentType = "claudeCode" | "codexCli" | "geminiCli";

export const DEFAULT_AGENT_TYPE: AgentType = "claudeCode";

export const AGENT_TYPES = {
  claudeCode: {
    label: "Claude Code",
    command: "claude",
  },
  codexCli: {
    label: "Codex CLI",
    command: "codex",
  },
  geminiCli: {
    label: "Gemini CLI",
    command: "gemini",
  },
} as const;

export interface Project {
  id: string;
  name: string;
  path: string;
  colorIndex: number;
  sortOrder: number;
  isActive: boolean;
  agentType: AgentType;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
  colorIndex?: number;
  agentType?: AgentType;
}

export interface UpdateProjectInput {
  name?: string;
  path?: string;
  colorIndex?: number;
  agentType?: AgentType;
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

export interface TmuxWindow {
  sessionName: string;
  windowIndex: number;
  windowName: string;
  windowActive: boolean;
  windowPanes: number;
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

export interface KillFailure {
  sessionName: string;
  error: string;
}

export interface KillAllResult {
  sessions: SessionInfo[];
  killedCount: number;
  failed: KillFailure[];
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
  codexCliInstalled: boolean;
  codexCliVersion: string | null;
  geminiCliInstalled: boolean;
  geminiCliVersion: string | null;
  shellType: string;
}

// ---------------------------------------------------------------------------
// Git types
// ---------------------------------------------------------------------------

export type GitRefType = "localBranch" | "remoteBranch" | "tag" | "head";

export interface GitRef {
  name: string;
  refType: GitRefType;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: string;
  parents: string[];
  refs: GitRef[];
  isAgentCommit: boolean;
}

export interface GitBranch {
  name: string;
  isRemote: boolean;
  isHead: boolean;
  commitHash: string;
  trackingBranch: string | null;
}

export interface GitWorktree {
  path: string;
  branch: string | null;
  commitHash: string;
  isBare: boolean;
  isMain: boolean;
  isPrunable: boolean;
  status: GitStatus | null;
}

export interface GitStatus {
  isDirty: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  modifiedPaths: string[];
}

export interface GitGraphData {
  commits: GitCommit[];
  branches: GitBranch[];
  worktrees: GitWorktree[];
  status: GitStatus;
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface FileDiff {
  path: string;
  status: FileStatus;
  insertions: number;
  deletions: number;
  patch: string;
}

export interface CommitDetail {
  hash: string;
  fullMessage: string;
  isAgentCommit: boolean;
  stats: DiffStats;
  files: FileDiff[];
}

export interface WorkingChanges {
  worktreePath: string;
  staged: FileDiff[];
  unstaged: FileDiff[];
  untracked: FileDiff[];
  stats: DiffStats;
}

export interface GitCommitsPage {
  commits: GitCommit[];
  hasMore: boolean;
}

export interface GitFetchResult {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// PTY commands (plugin:pty)
// ---------------------------------------------------------------------------

export async function killPty(pid: number): Promise<void> {
  return invoke<void>("plugin:pty|kill", { pid });
}

// ---------------------------------------------------------------------------
// Project commands
// ---------------------------------------------------------------------------

export async function createProject(
  name: string,
  path: string,
  colorIndex: number,
  agentType?: AgentType,
): Promise<Project> {
  return invoke<Project>("create_project", { name, path, colorIndex, agentType });
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

export async function reorderProjects(projectIds: string[]): Promise<void> {
  return invoke<void>("reorder_projects", { projectIds });
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

export async function splitTmuxPaneHorizontal(
  sessionName: string,
): Promise<void> {
  return invoke<void>("split_tmux_pane_horizontal", { sessionName });
}

export async function splitTmuxPaneVertical(
  sessionName: string,
): Promise<void> {
  return invoke<void>("split_tmux_pane_vertical", { sessionName });
}

export async function closeTmuxPane(sessionName: string): Promise<void> {
  return invoke<void>("close_tmux_pane", { sessionName });
}

export async function listTmuxWindows(
  sessionName: string,
): Promise<TmuxWindow[]> {
  return invoke<TmuxWindow[]>("list_tmux_windows", { sessionName });
}

export async function createTmuxWindow(sessionName: string): Promise<void> {
  return invoke<void>("create_tmux_window", { sessionName });
}

export async function closeTmuxWindow(sessionName: string): Promise<void> {
  return invoke<void>("close_tmux_window", { sessionName });
}

export async function closeTmuxWindowByName(
  sessionName: string,
  windowName: string,
): Promise<void> {
  return invoke<void>("close_tmux_window_by_name", { sessionName, windowName });
}

export async function nextTmuxWindow(sessionName: string): Promise<void> {
  return invoke<void>("next_tmux_window", { sessionName });
}

export async function previousTmuxWindow(sessionName: string): Promise<void> {
  return invoke<void>("previous_tmux_window", { sessionName });
}

export async function refreshTmuxClient(sessionName: string): Promise<void> {
  return invoke<void>("refresh_tmux_client", { sessionName });
}

export async function sendTmuxKeys(
  sessionName: string,
  keys: string,
): Promise<void> {
  return invoke<void>("send_tmux_keys", { sessionName, keys });
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

export async function killAllAppTmuxSessions(): Promise<KillAllResult> {
  return invoke<KillAllResult>("kill_all_app_tmux_sessions");
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

export async function pruneNotifications(
  retentionDays?: number,
): Promise<number> {
  return invoke<number>("prune_notifications", { retentionDays });
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

export interface AgentCommandInfo {
  agentType: AgentType;
  label: string;
  command: string;
  defaultCommand: string;
}

export async function getAgentCommands(): Promise<AgentCommandInfo[]> {
  return invoke<AgentCommandInfo[]>("get_agent_commands");
}

export async function setAgentCommandIpc(
  agentType: AgentType,
  command: string,
): Promise<void> {
  return invoke<void>("set_agent_command", { agentType, command });
}

// ---------------------------------------------------------------------------
// Environment commands
// ---------------------------------------------------------------------------

export async function checkEnvironment(): Promise<EnvironmentCheck> {
  return invoke<EnvironmentCheck>("check_environment");
}

// ---------------------------------------------------------------------------
// Git commands
// ---------------------------------------------------------------------------

export async function getGitGraph(
  path: string,
  limit?: number,
): Promise<GitGraphData> {
  return invoke<GitGraphData>("get_git_graph", { path, limit });
}

export async function getGitCommitsPage(
  path: string,
  skip: number,
  limit?: number,
): Promise<GitCommitsPage> {
  return invoke<GitCommitsPage>("get_git_commits_page", { path, skip, limit });
}

export async function getGitStatus(path: string): Promise<GitStatus> {
  return invoke<GitStatus>("get_git_status", { path });
}

export async function getCommitDetail(
  path: string,
  hash: string,
): Promise<CommitDetail> {
  return invoke<CommitDetail>("get_commit_detail", { path, hash });
}

export async function getWorkingChanges(
  worktreePath: string,
): Promise<WorkingChanges> {
  return invoke<WorkingChanges>("get_working_changes", { worktreePath });
}

export async function getFileDiff(
  worktreePath: string,
  filePath: string,
): Promise<FileDiff | null> {
  return invoke<FileDiff | null>("get_file_diff", { worktreePath, filePath });
}

export interface CommitResult {
  shortHash: string;
}

export async function gitStageFiles(
  worktreePath: string,
  filePaths: string[],
): Promise<void> {
  return invoke<void>("git_stage_files", { worktreePath, filePaths });
}

export async function gitStageAll(worktreePath: string): Promise<void> {
  return invoke<void>("git_stage_all", { worktreePath });
}

export async function gitUnstageFiles(
  worktreePath: string,
  filePaths: string[],
): Promise<void> {
  return invoke<void>("git_unstage_files", { worktreePath, filePaths });
}

export async function gitUnstageAll(worktreePath: string): Promise<void> {
  return invoke<void>("git_unstage_all", { worktreePath });
}

export async function gitDiscardFile(
  worktreePath: string,
  filePath: string,
  isUntracked: boolean,
): Promise<void> {
  return invoke<void>("git_discard_file", { worktreePath, filePath, isUntracked });
}

export async function gitCreateCommit(
  worktreePath: string,
  message: string,
): Promise<CommitResult> {
  return invoke<CommitResult>("git_create_commit", { worktreePath, message });
}

export async function gitFetchRemote(path: string): Promise<GitFetchResult> {
  return invoke<GitFetchResult>("git_fetch_remote", { path });
}

// ---------------------------------------------------------------------------
// Agent session monitoring commands
// ---------------------------------------------------------------------------

export async function startSessionMonitoring(
  sessionName: string,
  projectPath: string,
): Promise<void> {
  return invoke<void>("start_session_monitoring", { sessionName, projectPath });
}

// ---------------------------------------------------------------------------
// Agent worktree commands
// ---------------------------------------------------------------------------

export interface WorktreeTaskResult {
  windowName: string;
  worktreeName: string;
}

export interface RestoreResult {
  restoredCount: number;
  worktreeNames: string[];
}

export interface RemoveWorktreeResult {
  windowClosed: boolean;
  branchDeleted: boolean;
}

export async function startWorktreeTask(
  sessionName: string,
  taskName: string,
  projectPath: string,
  agentType?: AgentType,
): Promise<WorktreeTaskResult> {
  return invoke<WorktreeTaskResult>("start_worktree_task", {
    sessionName,
    taskName,
    projectPath,
    agentType,
  });
}

export async function restoreWorktreeWindows(
  sessionName: string,
  projectPath: string,
  agentType?: AgentType,
): Promise<RestoreResult> {
  return invoke<RestoreResult>("restore_worktree_windows", {
    sessionName,
    projectPath,
    agentType,
  });
}

export async function removeAgentWorktree(
  repoPath: string,
  worktreePath: string,
  sessionName: string | null,
  branchName: string | null,
  force: boolean,
): Promise<RemoveWorktreeResult> {
  return invoke<RemoveWorktreeResult>("remove_agent_worktree", {
    repoPath,
    worktreePath,
    sessionName,
    branchName,
    force,
  });
}

export async function pushGitBranch(
  repoPath: string,
  branchName: string,
  remote?: string,
): Promise<void> {
  return invoke<void>("push_git_branch", { repoPath, branchName, remote });
}

export async function gitCreateBranch(
  repoPath: string,
  branchName: string,
  startPoint: string,
): Promise<void> {
  return invoke<void>("git_create_branch", { repoPath, branchName, startPoint });
}

export async function gitDeleteBranch(
  repoPath: string,
  branchName: string,
  force = false,
): Promise<void> {
  return invoke<void>("git_delete_branch", { repoPath, branchName, force });
}

export async function gitSwitchBranch(
  repoPath: string,
  branchName: string,
): Promise<void> {
  return invoke<void>("git_switch_branch", { repoPath, branchName });
}

export async function selectTmuxWindow(
  sessionName: string,
  windowTarget: string,
): Promise<void> {
  return invoke<void>("select_tmux_window", { sessionName, windowTarget });
}

export async function sendKeysToTmuxWindow(
  sessionName: string,
  windowName: string,
  keys: string,
): Promise<void> {
  return invoke<void>("send_keys_to_tmux_window", {
    sessionName,
    windowName,
    keys,
  });
}

export async function sendKeysToTmuxWindowDelayed(
  sessionName: string,
  windowName: string,
  keys: string,
  agentType?: AgentType,
): Promise<void> {
  return invoke<void>("send_keys_to_tmux_window_delayed", {
    sessionName,
    windowName,
    keys,
    agentType,
  });
}

// ---------------------------------------------------------------------------
// Merge to Main types & commands
// ---------------------------------------------------------------------------

export type MergeToMainStatus = "success" | "conflictsDetected" | "dirtyWorktree";

export interface MergeToMainResult {
  status: MergeToMainStatus;
  mergeHash: string | null;
  branchName: string;
  conflictDetails: string | null;
  worktreeRemoved: boolean;
  branchDeleted: boolean;
  dirtyFileCount: number | null;
}

export interface RebaseStatusResult {
  inProgress: boolean;
  hasConflicts: boolean;
}

export async function mergeWorktreeToMain(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  sessionName: string | null,
): Promise<MergeToMainResult> {
  return invoke<MergeToMainResult>("merge_worktree_to_main", {
    repoPath,
    worktreePath,
    branchName,
    sessionName,
  });
}

export async function completeMergeToMain(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  sessionName: string | null,
): Promise<MergeToMainResult> {
  return invoke<MergeToMainResult>("complete_merge_to_main", {
    repoPath,
    worktreePath,
    branchName,
    sessionName,
  });
}

export async function abortMergeRebase(
  worktreePath: string,
): Promise<void> {
  return invoke<void>("abort_merge_rebase", { worktreePath });
}

export async function checkRebaseStatus(
  worktreePath: string,
): Promise<RebaseStatusResult> {
  return invoke<RebaseStatusResult>("check_rebase_status", { worktreePath });
}

export async function pruneStaleWorktrees(repoPath: string): Promise<void> {
  return invoke<void>("prune_stale_worktrees", { repoPath });
}

// ---------------------------------------------------------------------------
// SSH types
// ---------------------------------------------------------------------------

export type SshAuthType = "key" | "agent";

export interface SshConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  keyPath: string | null;
  projectId: string | null;
  isDefault: boolean;
  remoteProjectPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSshConnectionInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  authType?: SshAuthType;
  keyPath?: string;
  projectId?: string;
  isDefault?: boolean;
  remoteProjectPath?: string;
}

export interface UpdateSshConnectionInput {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: SshAuthType;
  keyPath?: string | null;
  projectId?: string | null;
  isDefault?: boolean;
  remoteProjectPath?: string | null;
}

export interface SshConnectResult {
  connectionId: string;
  connectionName: string;
  /** Local tmux window name (connect_with_profile only) */
  windowName: string | null;
  /** Local tmux session name (connect_with_profile only) */
  sessionName: string | null;
  /** Whether tmux is available on the remote server (connect_as_session only) */
  remoteTmuxAvailable: boolean | null;
  /** SSH arguments for direct PTY spawn (connect_as_session only) */
  sshArgs: string[] | null;
  /** Sanitized session name for remote tmux (connect_as_session only) */
  remoteSessionName: string | null;
  /** Shell-escaped tmux command with configuration for remote execution (connect_as_session only) */
  remoteTmuxCommand: string | null;
}

export interface SshTestResult {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// SSH commands
// ---------------------------------------------------------------------------

export async function createSshConnection(
  input: CreateSshConnectionInput,
): Promise<SshConnection> {
  return invoke<SshConnection>("create_ssh_connection", { input });
}

export async function listSshConnections(): Promise<SshConnection[]> {
  return invoke<SshConnection[]>("list_ssh_connections");
}

export async function listSshConnectionsByProject(
  projectId: string,
): Promise<SshConnection[]> {
  return invoke<SshConnection[]>("list_ssh_connections_by_project", {
    projectId,
  });
}

export async function getSshConnection(id: string): Promise<SshConnection> {
  return invoke<SshConnection>("get_ssh_connection", { id });
}

export async function updateSshConnection(
  id: string,
  input: UpdateSshConnectionInput,
): Promise<SshConnection> {
  return invoke<SshConnection>("update_ssh_connection", { id, input });
}

export async function deleteSshConnection(id: string): Promise<void> {
  return invoke<void>("delete_ssh_connection", { id });
}

export async function connectSshSession(id: string): Promise<SshConnectResult> {
  return invoke<SshConnectResult>("connect_ssh_session", { id });
}

export async function checkSshRemoteTmux(id: string): Promise<boolean | null> {
  return invoke<boolean | null>("check_ssh_remote_tmux", { id });
}

export async function testSshConnection(id: string): Promise<SshTestResult> {
  return invoke<SshTestResult>("test_ssh_connection", { id });
}

export async function testSshConnectionParams(
  host: string,
  port: number,
  username: string,
  authType: SshAuthType,
  keyPath?: string,
): Promise<SshTestResult> {
  return invoke<SshTestResult>("test_ssh_connection_params", {
    host,
    port,
    username,
    authType,
    keyPath: keyPath || null,
  });
}

// ---------------------------------------------------------------------------
// Remote tmux commands (via SSH)
// ---------------------------------------------------------------------------

export async function remoteTmuxSplitPaneVertical(
  connectionId: string,
  remoteSessionName: string,
): Promise<void> {
  return invoke<void>("remote_tmux_split_pane_vertical", {
    connectionId,
    remoteSessionName,
  });
}

export async function remoteTmuxSplitPaneHorizontal(
  connectionId: string,
  remoteSessionName: string,
): Promise<void> {
  return invoke<void>("remote_tmux_split_pane_horizontal", {
    connectionId,
    remoteSessionName,
  });
}

export async function remoteTmuxClosePane(
  connectionId: string,
  remoteSessionName: string,
): Promise<void> {
  return invoke<void>("remote_tmux_close_pane", {
    connectionId,
    remoteSessionName,
  });
}

export async function remoteTmuxCreateWindow(
  connectionId: string,
  remoteSessionName: string,
): Promise<void> {
  return invoke<void>("remote_tmux_create_window", {
    connectionId,
    remoteSessionName,
  });
}

export async function remoteTmuxCloseWindow(
  connectionId: string,
  remoteSessionName: string,
): Promise<void> {
  return invoke<void>("remote_tmux_close_window", {
    connectionId,
    remoteSessionName,
  });
}

export async function remoteTmuxNextWindow(
  connectionId: string,
  remoteSessionName: string,
): Promise<void> {
  return invoke<void>("remote_tmux_next_window", {
    connectionId,
    remoteSessionName,
  });
}

export async function remoteTmuxPreviousWindow(
  connectionId: string,
  remoteSessionName: string,
): Promise<void> {
  return invoke<void>("remote_tmux_previous_window", {
    connectionId,
    remoteSessionName,
  });
}

export async function remoteTmuxListWindows(
  connectionId: string,
  remoteSessionName: string,
): Promise<TmuxWindow[]> {
  return invoke<TmuxWindow[]>("remote_tmux_list_windows", {
    connectionId,
    remoteSessionName,
  });
}

export async function remoteTmuxListPanes(
  connectionId: string,
  remoteSessionName: string,
): Promise<TmuxPane[]> {
  return invoke<TmuxPane[]>("remote_tmux_list_panes", {
    connectionId,
    remoteSessionName,
  });
}

export async function remoteTmuxSendKeys(
  connectionId: string,
  remoteSessionName: string,
  keys: string,
): Promise<void> {
  return invoke<void>("remote_tmux_send_keys", {
    connectionId,
    remoteSessionName,
    keys,
  });
}

// ---------------------------------------------------------------------------
// Remote git commands (via SSH)
// ---------------------------------------------------------------------------

export async function getRemoteGitGraph(
  connectionId: string,
  limit?: number,
): Promise<GitGraphData> {
  return invoke<GitGraphData>("get_remote_git_graph", { connectionId, limit });
}

export async function getRemoteGitCommitsPage(
  connectionId: string,
  skip: number,
  limit?: number,
): Promise<GitCommitsPage> {
  return invoke<GitCommitsPage>("get_remote_git_commits_page", {
    connectionId,
    skip,
    limit,
  });
}

export async function getRemoteCommitDetail(
  connectionId: string,
  hash: string,
): Promise<CommitDetail> {
  return invoke<CommitDetail>("get_remote_commit_detail", {
    connectionId,
    hash,
  });
}

export async function detectRemoteGitPaths(
  host: string,
  port: number,
  username: string,
  authType: SshAuthType,
  keyPath?: string,
): Promise<string[]> {
  return invoke<string[]>("detect_remote_git_paths", {
    host,
    port,
    username,
    authType,
    keyPath,
  });
}

// ---------------------------------------------------------------------------
// File types
// ---------------------------------------------------------------------------

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
  extension: string | null;
}

export interface FileContent {
  content: string;
  language: string;
  path: string;
  size: number;
  isBinary: boolean;
}

export interface FileSearchResult {
  path: string;
  name: string;
  extension: string | null;
  score: number;
}

export interface ContentSearchMatch {
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

export interface ContentSearchFileResult {
  path: string;
  matches: ContentSearchMatch[];
}

export interface ContentSearchResult {
  files: ContentSearchFileResult[];
  totalMatches: number;
  totalFiles: number;
  truncated: boolean;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// File commands
// ---------------------------------------------------------------------------

export async function listDirectory(
  projectPath: string,
  relativePath: string,
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_directory", { projectPath, relativePath });
}

export async function readFile(
  projectPath: string,
  relativePath: string,
): Promise<FileContent> {
  return invoke<FileContent>("read_file", { projectPath, relativePath });
}

export async function writeFile(
  projectPath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  return invoke<void>("write_file", { projectPath, relativePath, content });
}

export async function resolveImportPath(
  projectPath: string,
  currentFile: string,
  importPath: string,
): Promise<string | null> {
  return invoke<string | null>("resolve_import_path", {
    projectPath,
    currentFile,
    importPath,
  });
}

export async function searchProjectFiles(
  projectPath: string,
  query: string,
  limit?: number,
): Promise<FileSearchResult[]> {
  return invoke<FileSearchResult[]>("search_project_files", {
    projectPath,
    query,
    limit,
  });
}

export async function searchFileContents(
  projectPath: string,
  query: string,
  caseSensitive: boolean,
  isRegex: boolean,
  maxResults?: number,
): Promise<ContentSearchResult> {
  return invoke<ContentSearchResult>("search_file_contents", {
    projectPath,
    query,
    caseSensitive,
    isRegex,
    maxResults,
  });
}

// ---------------------------------------------------------------------------
// Asset URL
// ---------------------------------------------------------------------------

/** Convert a project-relative file path to a webview-loadable asset URL.
 *  Rejects path traversal attempts (../) to prevent reading outside the project. */
export function getAssetUrl(projectPath: string, relativePath: string): string {
  if (relativePath.split("/").some((seg) => seg === "..")) {
    throw new Error(`Invalid path: path traversal detected in "${relativePath}"`);
  }
  const normalized = relativePath.replace(/^\/+/, "");
  return convertFileSrc(`${projectPath}/${normalized}`);
}

// ---------------------------------------------------------------------------
// File management commands (create / delete / rename / copy)
// ---------------------------------------------------------------------------

export async function createFile(
  projectPath: string,
  relativePath: string,
): Promise<FileEntry> {
  return invoke<FileEntry>("create_file", { projectPath, relativePath });
}

export async function createDirectory(
  projectPath: string,
  relativePath: string,
): Promise<FileEntry> {
  return invoke<FileEntry>("create_directory", { projectPath, relativePath });
}

export async function deletePath(
  projectPath: string,
  relativePath: string,
): Promise<void> {
  return invoke<void>("delete_path", { projectPath, relativePath });
}

export async function renamePath(
  projectPath: string,
  oldRelativePath: string,
  newRelativePath: string,
): Promise<FileEntry> {
  return invoke<FileEntry>("rename_path", {
    projectPath,
    oldRelativePath,
    newRelativePath,
  });
}

export async function copyExternalFiles(
  projectPath: string,
  targetRelativeDir: string,
  sourcePaths: string[],
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("copy_external_files", {
    projectPath,
    targetRelativeDir,
    sourcePaths,
  });
}

