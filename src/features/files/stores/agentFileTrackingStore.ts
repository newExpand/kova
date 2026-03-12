import { create } from "zustand";
import { normalizePathKey } from "../../git";
import { getSetting, setSetting } from "../../../lib/tauri/commands";

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
  userEdits: Record<string, FileTouch>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_CLEANUP_MS = 24 * 60 * 60 * 1000; // 24h — cleans up stale entries on persist/restore
const MAX_FILES_PER_SET = 50;

// ---------------------------------------------------------------------------
// Path utilities (exported for event-bridge)
// ---------------------------------------------------------------------------

/** Strip leading "./" and trailing "/" for consistent git path matching. */
function normalizeGitPath(p: string): string {
  return p.replace(/^\.\//, "").replace(/\/$/, "");
}

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
}

interface AgentFileTrackingActions {
  // Computed
  getWorkingSet: (projectPath: string) => ProjectWorkingSet;
  isAgentModified: (projectPath: string, relativePath: string) => boolean;
  isUserEdited: (projectPath: string, relativePath: string) => boolean;
  // Actions
  trackAgentWrite: (
    projectPath: string,
    relativePath: string,
    toolName: string,
  ) => void;
  trackUserEdit: (projectPath: string, relativePath: string) => void;
  removeUserEdit: (projectPath: string, relativePath: string) => void;
  removeAgentWrite: (projectPath: string, relativePath: string) => void;
  removeCommittedFiles: (projectPath: string, filePaths: string[]) => void;
  reconcileWithGitStatus: (projectPath: string, dirtyPaths: string[]) => void;
  clearProject: (projectPath: string) => void;
  restoreWorkingSets: () => Promise<void>;
  // Reset
  reset: () => void;
}

type AgentFileTrackingStore = AgentFileTrackingState & AgentFileTrackingActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: AgentFileTrackingState = {
  workingSets: {},
};

// ---------------------------------------------------------------------------
// Persistence (debounced, uses store via getState after initialization)
// ---------------------------------------------------------------------------

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistFailCount = 0;
const PERSIST_DEBOUNCE_MS = 2_000;
const PERSIST_STORAGE_KEY = "working_sets";
const MAX_SILENT_PERSIST_FAILURES = 3;

function persistWorkingSets(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      const { workingSets } = useAgentFileTrackingStore.getState();
      const cleaned: Record<string, ProjectWorkingSet> = {};
      const now = Date.now();
      for (const [key, ws] of Object.entries(workingSets)) {
        // writes: 24h stale cleanup; userEdits: no decay (cleaned via git-clean in CodeViewer)
        const writes = filterDecayed(ws.writes, STALE_CLEANUP_MS, now);
        const staleCount = Object.keys(ws.writes).length - Object.keys(writes).length;
        if (staleCount > 0) {
          console.info("[agentFileTracking] persist: pruned %d stale writes (>24h) for %s", staleCount, key);
        }
        const userEdits = ws.userEdits ?? {};
        if (Object.keys(writes).length > 0 || Object.keys(userEdits).length > 0) {
          cleaned[key] = { writes, userEdits };
        }
      }
      await setSetting(PERSIST_STORAGE_KEY, JSON.stringify(cleaned));
      persistFailCount = 0;
    } catch (err) {
      persistFailCount++;
      console.error("[agentFileTracking] persist failed (attempt %d):", persistFailCount, err);
      if (persistFailCount >= MAX_SILENT_PERSIST_FAILURES) {
        console.warn(
          "[agentFileTracking] Working set persistence has failed %d consecutive times. Data may be lost on restart.",
          persistFailCount,
        );
      }
    }
  }, PERSIST_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAgentFileTrackingStore = create<AgentFileTrackingStore>()(
  (set, get) => {
    /** Shared helper: remove a single entry from a working-set field. */
    function removeFromField(
      field: "writes" | "userEdits",
      projectPath: string,
      relativePath: string,
    ): void {
      const key = normalizePathKey(projectPath);

      set((state) => {
        const existing = state.workingSets[key];
        if (!existing?.[field]?.[relativePath]) return state;
        const { [relativePath]: _, ...rest } = existing[field];

        return {
          workingSets: {
            ...state.workingSets,
            [key]: { ...existing, [field]: rest },
          },
        };
      });
      persistWorkingSets();
    }

    return {
      ...initialState,

    // -- Computed --

    getWorkingSet: (projectPath) => {
      const key = normalizePathKey(projectPath);
      const ws = get().workingSets[key];
      if (!ws) return EMPTY_WORKING_SET;

      return {
        writes: ws.writes ?? {},
        userEdits: ws.userEdits ?? {},
      };
    },

    isAgentModified: (projectPath, relativePath) => {
      const key = normalizePathKey(projectPath);
      const ws = get().workingSets[key];
      if (!ws) return false;
      return !!ws.writes[relativePath];
    },

    isUserEdited: (projectPath, relativePath) => {
      const key = normalizePathKey(projectPath);
      const ws = get().workingSets[key];
      if (!ws) return false;
      return !!ws.userEdits?.[relativePath];
    },

    // -- Actions --

    trackAgentWrite: (projectPath, relativePath, toolName) => {
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
          userEdits: {},
        };

        let writes = { ...existing.writes, [relativePath]: touch };

        // Evict oldest if over cap
        writes = evictOldest(writes, MAX_FILES_PER_SET);

        return {
          workingSets: {
            ...state.workingSets,
            [key]: { writes, userEdits: existing.userEdits ?? {} },
          },
        };
      });

      persistWorkingSets();
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

      persistWorkingSets();
    },

    removeUserEdit: (projectPath, relativePath) =>
      removeFromField("userEdits", projectPath, relativePath),

    removeAgentWrite: (projectPath, relativePath) =>
      removeFromField("writes", projectPath, relativePath),

    removeCommittedFiles: (projectPath, filePaths) => {
      if (filePaths.length === 0) return;
      const key = normalizePathKey(projectPath);

      // Normalize paths: strip leading "./" and trailing "/" for consistent matching
      const normalized = filePaths.map(normalizeGitPath);

      set((state) => {
        const existing = state.workingSets[key];
        if (!existing) {
          console.info("[agentFileTracking] removeCommittedFiles: no working set for %s", key);
          return state;
        }

        const pathSet = new Set(normalized);
        let removedCount = 0;

        // Remove from writes
        const newWrites: Record<string, FileTouch> = {};
        for (const [fp, touch] of Object.entries(existing.writes)) {
          if (pathSet.has(fp)) {
            removedCount++;
          } else {
            newWrites[fp] = touch;
          }
        }

        // Remove from userEdits
        const newUserEdits: Record<string, FileTouch> = {};
        for (const [fp, touch] of Object.entries(existing.userEdits ?? {})) {
          if (pathSet.has(fp)) {
            removedCount++;
          } else {
            newUserEdits[fp] = touch;
          }
        }

        if (removedCount === 0) {
          console.info(
            "[agentFileTracking] removeCommittedFiles: none of %d paths matched tracked files for %s",
            normalized.length, key,
          );
          return state;
        }

        console.info(
          "[agentFileTracking] removeCommittedFiles: removed %d entries from working set for %s",
          removedCount, key,
        );

        return {
          workingSets: {
            ...state.workingSets,
            [key]: { writes: newWrites, userEdits: newUserEdits },
          },
        };
      });

      persistWorkingSets();
    },

    reconcileWithGitStatus: (projectPath, dirtyPaths) => {
      const key = normalizePathKey(projectPath);
      if (!get().workingSets[key]) return;

      const dirtySet = new Set(
        dirtyPaths.map(normalizeGitPath),
      );

      let didUpdate = false;

      set((state) => {
        const existing = state.workingSets[key];
        if (!existing) return state;

        // Keep only files that are still dirty in git
        let removedCount = 0;

        const newWrites: Record<string, FileTouch> = {};
        for (const [fp, touch] of Object.entries(existing.writes)) {
          if (dirtySet.has(fp)) {
            newWrites[fp] = touch;
          } else {
            removedCount++;
          }
        }

        const newUserEdits: Record<string, FileTouch> = {};
        for (const [fp, touch] of Object.entries(existing.userEdits ?? {})) {
          if (dirtySet.has(fp)) {
            newUserEdits[fp] = touch;
          } else {
            removedCount++;
          }
        }

        if (removedCount === 0) return state;

        didUpdate = true;
        console.info(
          "[agentFileTracking] reconcileWithGitStatus: removed %d clean entries for %s",
          removedCount, key,
        );

        return {
          workingSets: {
            ...state.workingSets,
            [key]: { writes: newWrites, userEdits: newUserEdits },
          },
        };
      });

      if (didUpdate) persistWorkingSets();
    },

    clearProject: (projectPath) => {
      const key = normalizePathKey(projectPath);

      set((state) => {
        const { [key]: _, ...restWorkingSets } = state.workingSets;
        return { workingSets: restWorkingSets };
      });

      persistWorkingSets();
    },

    restoreWorkingSets: async () => {
      // Cancel any pending persist that might overwrite restored data
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }

      try {
        const raw = await getSetting(PERSIST_STORAGE_KEY, "{}");
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;

        const now = Date.now();
        const restored: Record<string, ProjectWorkingSet> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value !== "object" || value === null) {
            console.warn("[agentFileTracking] restore: skipping malformed entry for key=%s", key);
            continue;
          }
          const ws = value as Record<string, unknown>;

          const rawWrites = typeof ws.writes === "object" && ws.writes !== null && !Array.isArray(ws.writes)
            ? (ws.writes as Record<string, FileTouch>)
            : {};
          const rawEdits = typeof ws.userEdits === "object" && ws.userEdits !== null && !Array.isArray(ws.userEdits)
            ? (ws.userEdits as Record<string, FileTouch>)
            : {};

          const writes = filterDecayed(rawWrites, STALE_CLEANUP_MS, now);
          const staleCount = Object.keys(rawWrites).length - Object.keys(writes).length;
          if (staleCount > 0) {
            console.info("[agentFileTracking] restore: pruned %d stale writes (>24h) for %s", staleCount, key);
          }
          // userEdits: no decay — cleaned via git-clean check in CodeViewer
          const userEdits = rawEdits;
          if (Object.keys(writes).length > 0 || Object.keys(userEdits).length > 0) {
            restored[key] = { writes, userEdits };
          }
        }

        // Merge with current state to preserve any writes that arrived during async restore
        set((state) => {
          const merged = { ...restored };
          for (const [key, current] of Object.entries(state.workingSets)) {
            if (merged[key]) {
              merged[key] = {
                writes: { ...merged[key].writes, ...current.writes },
                userEdits: { ...merged[key].userEdits, ...current.userEdits },
              };
            } else {
              merged[key] = current;
            }
          }
          return { workingSets: merged };
        });
      } catch (err) {
        console.error("[agentFileTracking] restore failed:", err);
      }
    },

    // -- Reset --

    reset: () => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      set(initialState);
    },
    };
  },
);
