export type TerminalStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface TerminalConfig {
  projectId: string;
  sessionName: string;
  cols: number;
  rows: number;
  cwd?: string;
  initialCommand?: string;
  /** SSH arguments for direct PTY spawn (bypasses local tmux) */
  sshArgs?: string[];
  /** When true, the terminal connects to a remote server via SSH PTY spawn instead of a local tmux session */
  isSshMode?: boolean;
  /** Remote tmux session name (set when SSH + remote tmux is active) */
  remoteTmuxSessionName?: string;
  /** SSH connection ID for remote tmux commands */
  sshConnectionId?: string;
}

export type PaneAction = "split-vertical" | "split-horizontal" | "new-window";
