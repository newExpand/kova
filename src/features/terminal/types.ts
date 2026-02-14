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
}

export type PaneAction = "split-vertical" | "split-horizontal" | "new-window";
