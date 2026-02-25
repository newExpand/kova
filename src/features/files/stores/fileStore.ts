import { create } from "zustand";
import type { FileEntry } from "../../../lib/tauri/commands";
import {
  listDirectory,
  readFile,
  writeFile,
} from "../../../lib/tauri/commands";
import type { OpenFile } from "../types";
import { MAX_OPEN_FILES } from "../types";

// ---------------------------------------------------------------------------
// Tree State (per project)
// ---------------------------------------------------------------------------

interface TreeState {
  entries: Record<string, FileEntry[]>; // keyed by relative dir path
  expandedDirs: Record<string, boolean>;
  loadingDirs: Record<string, boolean>;
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
  error: string | null;
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
  // Computed
  getActiveFile: () => OpenFile | undefined;
  getTreeState: (projectPath: string) => TreeState;
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
};

const initialState: FileState = {
  treeByProject: {},
  openFiles: [],
  activeFilePath: null,
  isFileLoading: false,
  isSaving: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useFileStore = create<FileStore>()((set, get) => ({
  ...initialState,

  // ── Tree Actions ──

  loadDirectory: async (projectPath, relativePath) => {
    const key = projectPath;
    const tree = get().treeByProject[key] ?? { ...emptyTreeState, entries: {}, expandedDirs: {}, loadingDirs: {} };

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
      const currentTree = get().treeByProject[key] ?? { ...emptyTreeState, entries: {}, expandedDirs: {}, loadingDirs: {} };
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
      const currentTree = get().treeByProject[key] ?? { ...emptyTreeState, entries: {}, expandedDirs: {}, loadingDirs: {} };
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
    const tree = get().treeByProject[key] ?? { ...emptyTreeState, entries: {}, expandedDirs: {}, loadingDirs: {} };
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
    }
  },

  // ── Computed ──

  getActiveFile: () => {
    const { openFiles, activeFilePath } = get();
    return openFiles.find((f) => f.path === activeFilePath);
  },

  getTreeState: (projectPath) => {
    return get().treeByProject[projectPath] ?? emptyTreeState;
  },

  // ── Reset ──

  reset: () => set(initialState),
}));
