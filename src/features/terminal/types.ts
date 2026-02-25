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
  /** Explicit SSH mode flag */
  isSshMode?: boolean;
}

export type PaneAction = "split-vertical" | "split-horizontal" | "new-window";
