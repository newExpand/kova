// Re-export IPC types from commands layer
export type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
} from "../../lib/tauri/commands";

export type ProjectStatus = "active" | "inactive" | "deleting";

export const COLOR_PALETTE = [
  "var(--color-project-0)",
  "var(--color-project-1)",
  "var(--color-project-2)",
  "var(--color-project-3)",
  "var(--color-project-4)",
  "var(--color-project-5)",
  "var(--color-project-6)",
  "var(--color-project-7)",
] as const;

export const MAX_COLOR_INDEX = COLOR_PALETTE.length - 1;
