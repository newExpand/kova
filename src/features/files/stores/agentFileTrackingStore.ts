import { create } from "zustand";
import { normalizePathKey } from "../../git";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileTouch {
  filePath: string; // relative path
  timestamp: number;
  toolName: string;
}

export interface ProjectWorkingSet {
  writes: Record<string, FileTouch>;
  reads: Record<string, FileTouch>;
  userEdits: Record<string, FileTouch>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const READ_DECAY_MS = 5 * 60 * 1000; // 5 min
const WRITE_DECAY_MS = 30 * 60 * 1000; // 30 min
const FLASH_DURATION_MS = 1_500;
const MAX_FILES_PER_SET = 50;

// ---------------------------------------------------------------------------
// External timer map (non-serializable, outside store)
// ---------------------------------------------------------------------------

const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Composite key for project-scoped flash tracking */
function flashKey(projectPath: string, relativePath: string): string {
  return `${normalizePathKey(projectPath)}:${relativePath}`;
}

// ---------------------------------------------------------------------------
// Path utilities (exported for event-bridge)
// ---------------------------------------------------------------------------

const WORKTREE_MARKER = "/.claude/worktrees/";

/** Resolve worktree file path to canonical project-relative path.
 *  Returns undefined if the path cannot be resolved to a relative path. */
export function resolveCanonicalFilePath(
  absoluteFilePath: string,
  projectPath: string,
): string | undefined {
  // If path contains worktree marker, strip the worktree prefix
  const wtIdx = absoluteFilePath.indexOf(WORKTREE_MARKER);
  if (wtIdx !== -1) {
    // e.g. /proj/.claude/worktrees/agent-a/src/file.ts → src/file.ts
    const afterMarker = absoluteFilePath.slice(wtIdx + WORKTREE_MARKER.length);
    const slashIdx = afterMarker.indexOf("/");
    if (slashIdx !== -1) {
      return afterMarker.slice(slashIdx + 1);
    }
    return undefined; // worktree path without file component
  }
  return toRelativePath(absoluteFilePath, projectPath);
}

/** Strip project prefix to get relative path.
 *  Returns undefined if the absolute path does not start with the project path. */
export function toRelativePath(
  absolutePath: string,
  projectPath: string,
): string | undefined {
  const norm = normalizePathKey(projectPath);
  const normAbs = normalizePathKey(absolutePath);
  if (normAbs.startsWith(norm + "/")) {
    return normAbs.slice(norm.length + 1);
  }
  return undefined;
}

/** Extract file_path from PostToolUse tool_input object */
export function extractFilePath(
  toolInput: Record<string, unknown>,
): string | undefined {
  const filePath = toolInput.file_path;
  if (typeof filePath === "string" && filePath.length > 0) {
    return filePath;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_WORKING_SET: ProjectWorkingSet = Object.freeze({
  writes: Object.freeze({}) as Record<string, FileTouch>,
  reads: Object.freeze({}) as Record<string, FileTouch>,
  userEdits: Object.freeze({}) as Record<string, FileTouch>,
});

function filterDecayed(
  record: Record<string, FileTouch>,
  maxAge: number,
  now: number,
): Record<string, FileTouch> {
  const result: Record<string, FileTouch> = {};
  for (const [key, touch] of Object.entries(record)) {
    if (now - touch.timestamp < maxAge) {
      result[key] = touch;
    }
  }
  return result;
}

function evictOldest(
  record: Record<string, FileTouch>,
  maxCount: number,
): Record<string, FileTouch> {
  const entries = Object.entries(record);
  if (entries.length <= maxCount) return record;

  entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
  return Object.fromEntries(entries.slice(0, maxCount));
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface AgentFileTrackingState {
  workingSets: Record<string, ProjectWorkingSet>;
  recentFlashes: Record<string, boolean>;
}

interface AgentFileTrackingActions {
  // Computed
  getWorkingSet: (projectPath: string) => ProjectWorkingSet;
  isAgentModified: (projectPath: string, relativePath: string) => boolean;
  isAgentRead: (projectPath: string, relativePath: string) => boolean;
  isRecentFlash: (projectPath: string, relativePath: string) => boolean;
  isUserEdited: (projectPath: string, relativePath: string) => boolean;
  // Actions
  trackFileTouch: (
    projectPath: string,
    relativePath: string,
    toolName: string,
    isWrite: boolean,
  ) => void;
  trackUserEdit: (projectPath: string, relativePath: string) => void;
  removeUserEdit: (projectPath: string, relativePath: string) => void;
  clearProject: (projectPath: string) => void;
  // Reset
  reset: () => void;
}

type AgentFileTrackingStore = AgentFileTrackingState & AgentFileTrackingActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: AgentFileTrackingState = {
  workingSets: {},
  recentFlashes: {},
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAgentFileTrackingStore = create<AgentFileTrackingStore>()(
  (set, get) => ({
    ...initialState,

    // -- Computed --

    getWorkingSet: (projectPath) => {
      const key = normalizePathKey(projectPath);
      const ws = get().workingSets[key];
      if (!ws) return EMPTY_WORKING_SET;

      const now = Date.now();
      return {
        writes: filterDecayed(ws.writes, WRITE_DECAY_MS, now),
        reads: filterDecayed(ws.reads, READ_DECAY_MS, now),
        userEdits: ws.userEdits ?? {},
      };
    },

    isAgentModified: (projectPath, relativePath) => {
      const key = normalizePathKey(projectPath);
      const ws = get().workingSets[key];
      if (!ws) return false;
      const touch = ws.writes[relativePath];
      if (!touch) return false;
      return Date.now() - touch.timestamp < WRITE_DECAY_MS;
    },

    isAgentRead: (projectPath, relativePath) => {
      const key = normalizePathKey(projectPath);
      const ws = get().workingSets[key];
      if (!ws) return false;
      // Not a read if already in writes
      if (ws.writes[relativePath]) return false;
      const touch = ws.reads[relativePath];
      if (!touch) return false;
      return Date.now() - touch.timestamp < READ_DECAY_MS;
    },

    isRecentFlash: (projectPath, relativePath) => {
      return !!get().recentFlashes[flashKey(projectPath, relativePath)];
    },

    isUserEdited: (projectPath, relativePath) => {
      const key = normalizePathKey(projectPath);
      const ws = get().workingSets[key];
      if (!ws) return false;
      return !!ws.userEdits?.[relativePath];
    },

    // -- Actions --

    trackFileTouch: (projectPath, relativePath, toolName, isWrite) => {
      const key = normalizePathKey(projectPath);
      const now = Date.now();
      const touch: FileTouch = {
        filePath: relativePath,
        timestamp: now,
        toolName,
      };

      set((state) => {
        const existing = state.workingSets[key] ?? {
          writes: {},
          reads: {},
          userEdits: {},
        };

        let writes = { ...existing.writes };
        let reads = { ...existing.reads };

        if (isWrite) {
          writes[relativePath] = touch;
          // Write supersedes read
          const { [relativePath]: _, ...restReads } = reads;
          reads = restReads;
        } else if (!writes[relativePath]) {
          // Only track read if not already a write
          reads[relativePath] = touch;
        }

        // Evict oldest if over cap (reads first, then writes)
        const writeCount = Object.keys(writes).length;
        const readCount = Object.keys(reads).length;
        if (writeCount + readCount > MAX_FILES_PER_SET) {
          const overBy = writeCount + readCount - MAX_FILES_PER_SET;
          reads = evictOldest(reads, Math.max(0, readCount - overBy));
          const remaining = Object.keys(reads).length;
          if (writeCount + remaining > MAX_FILES_PER_SET) {
            writes = evictOldest(writes, MAX_FILES_PER_SET - remaining);
          }
        }

        const fk = flashKey(projectPath, relativePath);
        const recentFlashes = isWrite
          ? { ...state.recentFlashes, [fk]: true }
          : state.recentFlashes;

        return {
          workingSets: {
            ...state.workingSets,
            [key]: { writes, reads, userEdits: existing.userEdits ?? {} },
          },
          recentFlashes,
        };
      });

      // Flash timer (external)
      if (isWrite) {
        const fk = flashKey(projectPath, relativePath);
        const existingTimer = flashTimers.get(fk);
        if (existingTimer) clearTimeout(existingTimer);

        flashTimers.set(
          fk,
          setTimeout(() => {
            flashTimers.delete(fk);
            set((state) => {
              const { [fk]: _, ...rest } = state.recentFlashes;
              return { recentFlashes: rest };
            });
          }, FLASH_DURATION_MS),
        );
      }
    },

    trackUserEdit: (projectPath, relativePath) => {
      const key = normalizePathKey(projectPath);
      const now = Date.now();
      const touch: FileTouch = {
        filePath: relativePath,
        timestamp: now,
        toolName: "UserSave",
      };

      set((state) => {
        const existing = state.workingSets[key] ?? {
          writes: {},
          reads: {},
          userEdits: {},
        };
        return {
          workingSets: {
            ...state.workingSets,
            [key]: {
              ...existing,
              userEdits: { ...existing.userEdits, [relativePath]: touch },
            },
          },
        };
      });
    },

    removeUserEdit: (projectPath, relativePath) => {
      const key = normalizePathKey(projectPath);
      set((state) => {
        const existing = state.workingSets[key];
        if (!existing?.userEdits?.[relativePath]) return state;
        const { [relativePath]: _, ...restEdits } = existing.userEdits;
        return {
          workingSets: {
            ...state.workingSets,
            [key]: { ...existing, userEdits: restEdits },
          },
        };
      });
    },

    clearProject: (projectPath) => {
      const key = normalizePathKey(projectPath);
      const ws = get().workingSets[key];

      // Clear flash timers for files in this project's working set
      if (ws) {
        const allFiles = [...Object.keys(ws.writes), ...Object.keys(ws.reads), ...Object.keys(ws.userEdits ?? {})];
        for (const filePath of allFiles) {
          const fk = flashKey(projectPath, filePath);
          const timer = flashTimers.get(fk);
          if (timer) {
            clearTimeout(timer);
            flashTimers.delete(fk);
          }
        }
      }

      set((state) => {
        const { [key]: _, ...restWorkingSets } = state.workingSets;
        // Clean recentFlashes for files in this project
        let cleanedFlashes = state.recentFlashes;
        if (ws) {
          cleanedFlashes = { ...state.recentFlashes };
          for (const filePath of [...Object.keys(ws.writes), ...Object.keys(ws.reads), ...Object.keys(ws.userEdits ?? {})]) {
            delete cleanedFlashes[flashKey(projectPath, filePath)];
          }
        }
        return { workingSets: restWorkingSets, recentFlashes: cleanedFlashes };
      });
    },

    // -- Reset --

    reset: () => {
      for (const timer of flashTimers.values()) clearTimeout(timer);
      flashTimers.clear();
      set(initialState);
    },
  }),
);
