export type TerminalStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type SessionMode = "new" | "attach";

export interface TerminalConfig {
  projectId: string;
  sessionName: string;
  mode: SessionMode;
  cols: number;
  rows: number;
  cwd?: string;
  initialCommand?: string;
}
