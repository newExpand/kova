import { create } from "zustand";
import type { FileEntry } from "../../../lib/tauri/commands";
import {
  listDirectory,
  readFile,
  writeFile,
  createFile,
  createDirectory,
  deletePath,
  renamePath,
  copyExternalEntries,
} from "../../../lib/tauri/commands";
import type { ConflictStrategy, CopyResult } from "../../../lib/tauri/commands";
import type { OpenFile, ScrollTarget } from "../types";
import { MAX_OPEN_FILES } from "../types";
import { useAgentFileTrackingStore } from "./agentFileTrackingStore";

// ---------------------------------------------------------------------------
// Tree State (per project)
// ---------------------------------------------------------------------------

interface InlineCreateState {
  parentDir: string;
  isDir: boolean;
}

interface TreeState {
  entries: Record<string, FileEntry[]>; // keyed by relative dir path
  expandedDirs: Record<string, boolean>;
  loadingDirs: Record<string, boolean>;
  inlineCreate: InlineCreateState | null;
}

// ---------------------------------------------------------------------------
// Store Interface
// ---------------------------------------------------------------------------

interface FileState {
  // Tree state per project
  treeByProject: Record<string, TreeState>;
  // Open files
  openFiles: OpenFile[];
  activeFilePath: string | null;
  // Loading
  isFileLoading: boolean;
  isSaving: boolean;
  isMutating: boolean;
  error: string | null;
  // Scroll target (set by terminal links or event bridge)
  pendingScrollTarget: ScrollTarget | null;
}

interface FileActions {
  // Tree actions
  loadDirectory: (projectPath: string, relativePath: string) => Promise<void>;
  toggleDirectory: (projectPath: string, relativePath: string) => void;
  // File actions
  openFile: (projectPath: string, relativePath: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  updateFileContent: (path: string, content: string) => void;
  saveFile: (projectPath: string, path: string) => Promise<void>;
  refreshFile: (projectPath: string, relativePath: string) => Promise<void>;
  // File management actions (return error string on failure, null on success)
  startInlineCreate: (projectPath: string, parentDir: string, isDir: boolean) => void;
  cancelInlineCreate: (projectPath: string) => void;
  createEntry: (projectPath: string, parentDir: string, name: string, isDir: boolean) => Promise<string | null>;
  deleteEntry: (projectPath: string, relativePath: string) => Promise<string | null>;
  renameEntry: (projectPath: string, oldPath: string, newName: string) => Promise<string | null>;
  copyExternalEntriesToTree: (projectPath: string, targetDir: string, sourcePaths: string[], strategy: ConflictStrategy) => Promise<CopyResult | null>;
  // Scroll target
  setScrollTarget: (target: ScrollTarget) => void;
  clearScrollTarget: () => void;
  // Computed
  getActiveFile: () => OpenFile | undefined;
  getTreeState: (projectPath: string) => TreeState;
  getFilteredEntries: (projectPath: string, query: string) => FileEntry[];
  // Reset
  reset: () => void;
}

type FileStore = FileState & FileActions;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const emptyTreeState: TreeState = {
  entries: {},
  expandedDirs: {},
  loadingDirs: {},
  inlineCreate: null,
};

const initialState: FileState = {
  treeByProject: {},
  openFiles: [],
  activeFilePath: null,
  isFileLoading: false,
  isSaving: false,
  isMutating: false,
  error: null,
  pendingScrollTarget: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get parent directory from a relative path (e.g. "src/foo/bar.ts" → "src/foo") */
function getParentDir(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx === -1 ? "" : relativePath.slice(0, idx);
}

/** Create a fresh tree state to avoid mutating the shared emptyTreeState */
function freshTreeState(): TreeState {
  return { entries: {}, expandedDirs: {}, loadingDirs: {}, inlineCreate: null };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useFileStore = create<FileStore>()((set, get) => ({
  ...initialState,

  // ── Tree Actions ──

  loadDirectory: async (projectPath, relativePath) => {
    const key = projectPath;
    const tree = get().treeByProject[key] ?? freshTreeState();

    // Mark loading
    set({
      treeByProject: {
        ...get().treeByProject,
        [key]: {
          ...tree,
          loadingDirs: { ...tree.loadingDirs, [relativePath]: true },
        },
      },
    });

    try {
      const entries = await listDirectory(projectPath, relativePath);
      const currentTree = get().treeByProject[key] ?? freshTreeState();
      const newLoadingDirs = { ...currentTree.loadingDirs };
      delete newLoadingDirs[relativePath];

      set({
        treeByProject: {
          ...get().treeByProject,
          [key]: {
            ...currentTree,
            entries: { ...currentTree.entries, [relativePath]: entries },
            loadingDirs: newLoadingDirs,
          },
        },
        error: null,
      });
    } catch (e) {
      const currentTree = get().treeByProject[key] ?? freshTreeState();
      const newLoadingDirs = { ...currentTree.loadingDirs };
      delete newLoadingDirs[relativePath];

      set({
        treeByProject: {
          ...get().treeByProject,
          [key]: {
            ...currentTree,
            loadingDirs: newLoadingDirs,
          },
        },
        error: String(e),
      });
    }
  },

  toggleDirectory: (projectPath, relativePath) => {
    const key = projectPath;
    const tree = get().treeByProject[key] ?? freshTreeState();
    const isExpanded = tree.expandedDirs[relativePath] ?? false;

    set({
      treeByProject: {
        ...get().treeByProject,
        [key]: {
          ...tree,
          expandedDirs: {
            ...tree.expandedDirs,
            [relativePath]: !isExpanded,
          },
        },
      },
    });

    // Load if expanding and not yet loaded
    if (!isExpanded && !tree.entries[relativePath]) {
      get().loadDirectory(projectPath, relativePath);
    }
  },

  // ── File Actions ──

  openFile: async (projectPath, relativePath) => {
    const { openFiles, activeFilePath } = get();

    // If already open, just activate
    const existing = openFiles.find((f) => f.path === relativePath);
    if (existing) {
      if (activeFilePath !== relativePath) {
        set({ activeFilePath: relativePath });
      }
      return;
    }

    set({ isFileLoading: true, error: null });

    try {
      const content = await readFile(projectPath, relativePath);
      const fileName = relativePath.split("/").pop() ?? relativePath;

      const newFile: OpenFile = {
        path: content.path,
        name: fileName,
        language: content.language,
        content: content.content,
        originalContent: content.content,
        isDirty: false,
        isBinary: content.isBinary,
      };

      let updatedFiles = [...get().openFiles];

      // If at max, close oldest non-dirty file
      if (updatedFiles.length >= MAX_OPEN_FILES) {
        const closableIdx = updatedFiles.findIndex((f) => !f.isDirty);
        if (closableIdx !== -1) {
          updatedFiles.splice(closableIdx, 1);
        } else {
          // All dirty — close the first one anyway
          updatedFiles.splice(0, 1);
        }
      }

      updatedFiles.push(newFile);

      set({
        openFiles: updatedFiles,
        activeFilePath: newFile.path,
        isFileLoading: false,
      });
    } catch (e) {
      set({ isFileLoading: false, error: String(e) });
    }
  },

  closeFile: (path) => {
    const { openFiles, activeFilePath } = get();
    const idx = openFiles.findIndex((f) => f.path === path);
    if (idx === -1) return;

    const updatedFiles = openFiles.filter((f) => f.path !== path);
    let newActive = activeFilePath;

    if (activeFilePath === path) {
      // Activate neighbor or null
      if (updatedFiles.length > 0) {
        const newIdx = Math.min(idx, updatedFiles.length - 1);
        newActive = updatedFiles[newIdx]?.path ?? null;
      } else {
        newActive = null;
      }
    }

    set({ openFiles: updatedFiles, activeFilePath: newActive });
  },

  setActiveFile: (path) => {
    set({ activeFilePath: path });
  },

  updateFileContent: (path, content) => {
    const { openFiles } = get();
    set({
      openFiles: openFiles.map((f) =>
        f.path === path
          ? { ...f, content, isDirty: content !== f.originalContent }
          : f,
      ),
    });
  },

  saveFile: async (projectPath, path) => {
    const file = get().openFiles.find((f) => f.path === path);
    if (!file || !file.isDirty) return;

    set({ isSaving: true, error: null });

    try {
      await writeFile(projectPath, path, file.content);
      set({
        openFiles: get().openFiles.map((f) =>
          f.path === path
            ? { ...f, isDirty: false, originalContent: f.content }
            : f,
        ),
        isSaving: false,
      });
    } catch (e) {
      set({ isSaving: false, error: String(e) });
      return;
    }
    // Track as user edit (outside try-catch: save already succeeded)
    useAgentFileTrackingStore.getState().trackUserEdit(projectPath, path);
  },

  // Re-read an already-open file from disk (used after agent edits)
  refreshFile: async (projectPath, relativePath) => {
    const { openFiles } = get();
    const existing = openFiles.find((f) => f.path === relativePath);
    if (!existing) {
      // Not open — just open normally
      return get().openFile(projectPath, relativePath);
    }

    try {
      const content = await readFile(projectPath, relativePath);
      set({
        openFiles: get().openFiles.map((f) =>
          f.path === relativePath
            ? { ...f, content: content.content, originalContent: content.content, isDirty: false }
            : f,
        ),
        activeFilePath: relativePath,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ── File Management Actions ──

  startInlineCreate: (projectPath, parentDir, isDir) => {
    const key = projectPath;
    const tree = get().treeByProject[key] ?? freshTreeState();

    // Ensure parent dir is expanded
    const newExpanded = { ...tree.expandedDirs, [parentDir]: true };

    set({
      treeByProject: {
        ...get().treeByProject,
        [key]: {
          ...tree,
          expandedDirs: newExpanded,
          inlineCreate: { parentDir, isDir },
        },
      },
    });

    // Load parent if not yet loaded
    if (!tree.entries[parentDir]) {
      get().loadDirectory(projectPath, parentDir);
    }
  },

  cancelInlineCreate: (projectPath) => {
    const key = projectPath;
    const tree = get().treeByProject[key];
    if (!tree || !tree.inlineCreate) return;

    set({
      treeByProject: {
        ...get().treeByProject,
        [key]: { ...tree, inlineCreate: null },
      },
    });
  },

  createEntry: async (projectPath, parentDir, name, isDir) => {
    const relativePath = parentDir ? `${parentDir}/${name}` : name;

    set({ isMutating: true, error: null });
    try {
      if (isDir) {
        await createDirectory(projectPath, relativePath);
      } else {
        await createFile(projectPath, relativePath);
      }

      // Clear inline create state
      const key = projectPath;
      const tree = get().treeByProject[key];
      if (tree) {
        set({
          treeByProject: {
            ...get().treeByProject,
            [key]: { ...tree, inlineCreate: null },
          },
        });
      }

      // Refresh parent directory and ensure it stays expanded
      await get().loadDirectory(projectPath, parentDir);
      const refreshedTree = get().treeByProject[key];
      if (refreshedTree && !refreshedTree.expandedDirs[parentDir]) {
        set({
          treeByProject: {
            ...get().treeByProject,
            [key]: {
              ...refreshedTree,
              expandedDirs: { ...refreshedTree.expandedDirs, [parentDir]: true },
            },
          },
        });
      }

      // Open the file if it was a file creation
      if (!isDir) {
        await get().openFile(projectPath, relativePath);
      }
      return null;
    } catch (e) {
      const msg = String(e);
      set({ error: msg });
      return msg;
    } finally {
      set({ isMutating: false });
    }
  },

  deleteEntry: async (projectPath, relativePath) => {
    set({ isMutating: true, error: null });
    try {
      await deletePath(projectPath, relativePath);

      // Close the file itself or any files inside a deleted directory
      const { openFiles } = get();
      const deletedPrefix = relativePath + "/";
      const filesToClose = openFiles.filter(
        (f) => f.path === relativePath || f.path.startsWith(deletedPrefix),
      );
      for (const f of filesToClose) {
        get().closeFile(f.path);
      }

      // Clean up working set tracking for all tracked descendants (not just open files)
      const tracking = useAgentFileTrackingStore.getState();
      const ws = tracking.getWorkingSet(projectPath);
      for (const fp of [...Object.keys(ws.writes), ...Object.keys(ws.userEdits)]) {
        if (fp === relativePath || fp.startsWith(deletedPrefix)) {
          tracking.removeUserEdit(projectPath, fp);
          tracking.removeAgentWrite(projectPath, fp);
        }
      }

      // Refresh parent directory
      const parentDir = getParentDir(relativePath);
      await get().loadDirectory(projectPath, parentDir);
      return null;
    } catch (e) {
      const msg = String(e);
      set({ error: msg });
      return msg;
    } finally {
      set({ isMutating: false });
    }
  },

  renameEntry: async (projectPath, oldPath, newName) => {
    const parentDir = getParentDir(oldPath);
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;

    set({ isMutating: true, error: null });
    try {
      await renamePath(projectPath, oldPath, newPath);

      // Update open files: exact match or files inside a renamed directory
      const { openFiles, activeFilePath } = get();
      const oldPrefix = oldPath + "/";
      const updatedFiles = openFiles.map((f) => {
        if (f.path === oldPath) {
          return { ...f, path: newPath, name: newName };
        }
        if (f.path.startsWith(oldPrefix)) {
          const newFilePath = newPath + "/" + f.path.slice(oldPrefix.length);
          const newFileName = newFilePath.split("/").pop() ?? f.name;
          return { ...f, path: newFilePath, name: newFileName };
        }
        return f;
      });
      let newActive = activeFilePath;
      if (activeFilePath === oldPath) {
        newActive = newPath;
      } else if (activeFilePath && activeFilePath.startsWith(oldPrefix)) {
        newActive = newPath + "/" + activeFilePath.slice(oldPrefix.length);
      }
      set({ openFiles: updatedFiles, activeFilePath: newActive });

      // Migrate working set tracking from old paths to new paths
      const tracking = useAgentFileTrackingStore.getState();
      const ws = tracking.getWorkingSet(projectPath);

      // Collect entries to migrate before modifying
      const toMigrate: Array<{ oldFp: string; newFp: string; source: "writes" | "userEdits" }> = [];
      if (ws.writes[oldPath]) toMigrate.push({ oldFp: oldPath, newFp: newPath, source: "writes" });
      if (ws.userEdits[oldPath]) toMigrate.push({ oldFp: oldPath, newFp: newPath, source: "userEdits" });
      for (const fp of Object.keys(ws.writes)) {
        if (fp.startsWith(oldPrefix)) {
          toMigrate.push({ oldFp: fp, newFp: newPath + "/" + fp.slice(oldPrefix.length), source: "writes" });
        }
      }
      for (const fp of Object.keys(ws.userEdits)) {
        if (fp.startsWith(oldPrefix)) {
          toMigrate.push({ oldFp: fp, newFp: newPath + "/" + fp.slice(oldPrefix.length), source: "userEdits" });
        }
      }

      // Remove old entries, then re-register at new paths
      for (const m of toMigrate) {
        tracking.removeUserEdit(projectPath, m.oldFp);
        tracking.removeAgentWrite(projectPath, m.oldFp);
      }
      for (const m of toMigrate) {
        if (m.source === "writes") {
          tracking.trackAgentWrite(projectPath, m.newFp, "renamed");
        } else {
          tracking.trackUserEdit(projectPath, m.newFp);
        }
      }

      // Refresh parent directory
      await get().loadDirectory(projectPath, parentDir);
      return null;
    } catch (e) {
      const msg = String(e);
      set({ error: msg });
      return msg;
    } finally {
      set({ isMutating: false });
    }
  },

  copyExternalEntriesToTree: async (projectPath, targetDir, sourcePaths, strategy) => {
    set({ isMutating: true, error: null });
    try {
      const result = await copyExternalEntries(projectPath, targetDir, sourcePaths, strategy);
      await get().loadDirectory(projectPath, targetDir);
      if (result.skipped.length > 0) {
        set({ error: `${result.skipped.length} file(s) skipped (already exist or symlinks)` });
      }
      return result;
    } catch (e) {
      const msg = String(e);
      set({ error: msg });
      return null;
    } finally {
      set({ isMutating: false });
    }
  },

  // ── Scroll Target ──

  setScrollTarget: (target) => set({ pendingScrollTarget: target }),

  clearScrollTarget: () => set({ pendingScrollTarget: null }),

  // ── Computed ──

  getActiveFile: () => {
    const { openFiles, activeFilePath } = get();
    return openFiles.find((f) => f.path === activeFilePath);
  },

  getTreeState: (projectPath) => {
    return get().treeByProject[projectPath] ?? emptyTreeState;
  },

  getFilteredEntries: (projectPath, query) => {
    const tree = get().treeByProject[projectPath];
    if (!tree || !query.trim()) return [];

    const lowerQuery = query.toLowerCase();
    const results: FileEntry[] = [];

    for (const entries of Object.values(tree.entries)) {
      for (const entry of entries) {
        if (!entry.isDir && entry.name.toLowerCase().includes(lowerQuery)) {
          results.push(entry);
          if (results.length >= 100) return results;
        }
      }
    }

    return results;
  },

  // ── Reset ──

  reset: () => set(initialState),
}));
