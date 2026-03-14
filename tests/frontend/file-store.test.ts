/**
 * File Store Tests — FileTree + Open Files + CRUD management
 *
 * Tests:
 * - Directory loading and toggling
 * - File open / close / activate / content editing
 * - File save with dirty tracking
 * - CRUD: create, delete, rename entries
 * - External copy (drag-and-drop)
 * - Inline create state management
 * - Computed helpers (getActiveFile, getTreeState, getFilteredEntries)
 * - Store reset
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";

// ── Mocks (hoisted before imports) ────────────────────────────────────

vi.mock("../../src/lib/tauri/commands", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  createFile: vi.fn(),
  createDirectory: vi.fn(),
  deletePath: vi.fn(),
  renamePath: vi.fn(),
  copyExternalEntries: vi.fn(),
}));

vi.mock("../../src/features/files/stores/agentFileTrackingStore", () => ({
  useAgentFileTrackingStore: {
    getState: vi.fn(() => ({
      trackUserEdit: vi.fn(),
      trackAgentWrite: vi.fn(),
      removeUserEdit: vi.fn(),
      removeAgentWrite: vi.fn(),
      getWorkingSet: vi.fn(() => ({ writes: {}, userEdits: {} })),
    })),
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────

import { useFileStore } from "../../src/features/files/stores/fileStore";
import * as commands from "../../src/lib/tauri/commands";
import type { FileEntry, FileContent, CopyResult } from "../../src/lib/tauri/commands";

const mockCommands = vi.mocked(commands);

// ── Test Data ─────────────────────────────────────────────────────────

const PROJECT_PATH = "/Users/test/my-project";
const PROJECT_PATH_2 = "/Users/test/other-project";

function makeFileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    name: "file.ts",
    path: "src/file.ts",
    isDir: false,
    size: 1024,
    modified: "2024-01-01T00:00:00Z",
    extension: "ts",
    ...overrides,
  };
}

function makeDirEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    name: "src",
    path: "src",
    isDir: true,
    size: 0,
    modified: "2024-01-01T00:00:00Z",
    extension: null,
    ...overrides,
  };
}

function makeFileContent(overrides: Partial<FileContent> = {}): FileContent {
  return {
    content: "const x = 1;",
    language: "typescript",
    path: "src/file.ts",
    size: 12,
    isBinary: false,
    ...overrides,
  };
}

const MOCK_ENTRIES: FileEntry[] = [
  makeDirEntry({ name: "src", path: "src" }),
  makeFileEntry({ name: "README.md", path: "README.md", extension: "md" }),
  makeFileEntry({ name: "package.json", path: "package.json", extension: "json" }),
];

const MOCK_SRC_ENTRIES: FileEntry[] = [
  makeFileEntry({ name: "index.ts", path: "src/index.ts" }),
  makeFileEntry({ name: "app.ts", path: "src/app.ts" }),
  makeDirEntry({ name: "utils", path: "src/utils" }),
];

// ── Tests ─────────────────────────────────────────────────────────────

describe("FileStore", () => {
  beforeEach(() => {
    useFileStore.getState().reset();
    vi.clearAllMocks();
  });

  // ── loadDirectory ───────────────────────────────────────────────────

  describe("loadDirectory", () => {
    it("loads entries and clears loading state on success", async () => {
      mockCommands.listDirectory.mockResolvedValue(MOCK_ENTRIES);

      await act(async () => {
        await useFileStore.getState().loadDirectory(PROJECT_PATH, "");
      });

      const state = useFileStore.getState();
      const tree = state.getTreeState(PROJECT_PATH);
      expect(tree.entries[""]).toEqual(MOCK_ENTRIES);
      expect(tree.loadingDirs[""]).toBeUndefined();
      expect(state.error).toBeNull();
    });

    it("sets error and clears loading on failure", async () => {
      mockCommands.listDirectory.mockRejectedValue(new Error("Permission denied"));

      await act(async () => {
        await useFileStore.getState().loadDirectory(PROJECT_PATH, "src");
      });

      const state = useFileStore.getState();
      const tree = state.getTreeState(PROJECT_PATH);
      expect(tree.loadingDirs["src"]).toBeUndefined();
      expect(state.error).toBe("Error: Permission denied");
    });

    it("stores entries per project path isolation", async () => {
      mockCommands.listDirectory
        .mockResolvedValueOnce(MOCK_ENTRIES)
        .mockResolvedValueOnce(MOCK_SRC_ENTRIES);

      await act(async () => {
        await useFileStore.getState().loadDirectory(PROJECT_PATH, "");
      });
      await act(async () => {
        await useFileStore.getState().loadDirectory(PROJECT_PATH_2, "");
      });

      const state = useFileStore.getState();
      expect(state.getTreeState(PROJECT_PATH).entries[""]).toEqual(MOCK_ENTRIES);
      expect(state.getTreeState(PROJECT_PATH_2).entries[""]).toEqual(MOCK_SRC_ENTRIES);
    });
  });

  // ── toggleDirectory ─────────────────────────────────────────────────

  describe("toggleDirectory", () => {
    it("toggles expandedDirs from false to true", () => {
      act(() => {
        useFileStore.getState().toggleDirectory(PROJECT_PATH, "src");
      });

      const tree = useFileStore.getState().getTreeState(PROJECT_PATH);
      expect(tree.expandedDirs["src"]).toBe(true);
    });

    it("toggles expandedDirs from true to false", () => {
      // Pre-expand
      act(() => {
        useFileStore.getState().toggleDirectory(PROJECT_PATH, "src");
      });
      expect(useFileStore.getState().getTreeState(PROJECT_PATH).expandedDirs["src"]).toBe(true);

      // Collapse
      act(() => {
        useFileStore.getState().toggleDirectory(PROJECT_PATH, "src");
      });
      expect(useFileStore.getState().getTreeState(PROJECT_PATH).expandedDirs["src"]).toBe(false);
    });

    it("triggers loadDirectory when expanding unloaded directory", () => {
      mockCommands.listDirectory.mockResolvedValue(MOCK_SRC_ENTRIES);

      act(() => {
        useFileStore.getState().toggleDirectory(PROJECT_PATH, "src");
      });

      expect(mockCommands.listDirectory).toHaveBeenCalledWith(PROJECT_PATH, "src");
    });

    it("does not trigger load when expanding already-loaded directory", async () => {
      mockCommands.listDirectory.mockResolvedValue(MOCK_SRC_ENTRIES);

      // Pre-load the directory
      await act(async () => {
        await useFileStore.getState().loadDirectory(PROJECT_PATH, "src");
      });
      vi.clearAllMocks();

      // Collapse then expand again
      act(() => {
        useFileStore.getState().toggleDirectory(PROJECT_PATH, "src");
      });
      act(() => {
        useFileStore.getState().toggleDirectory(PROJECT_PATH, "src");
      });

      expect(mockCommands.listDirectory).not.toHaveBeenCalled();
    });
  });

  // ── openFile ────────────────────────────────────────────────────────

  describe("openFile", () => {
    it("opens file and sets it as active", async () => {
      const content = makeFileContent({ path: "src/file.ts", content: "hello" });
      mockCommands.readFile.mockResolvedValue(content);

      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "src/file.ts");
      });

      const state = useFileStore.getState();
      expect(state.openFiles).toHaveLength(1);
      expect(state.openFiles[0].path).toBe("src/file.ts");
      expect(state.openFiles[0].name).toBe("file.ts");
      expect(state.openFiles[0].content).toBe("hello");
      expect(state.openFiles[0].originalContent).toBe("hello");
      expect(state.openFiles[0].isDirty).toBe(false);
      expect(state.openFiles[0].language).toBe("typescript");
      expect(state.activeFilePath).toBe("src/file.ts");
      expect(state.isFileLoading).toBe(false);
    });

    it("activates existing file without re-reading", async () => {
      const content = makeFileContent({ path: "src/file.ts" });
      mockCommands.readFile.mockResolvedValue(content);

      // Open the file first
      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "src/file.ts");
      });

      // Open a second file to change the active
      const content2 = makeFileContent({ path: "src/other.ts", language: "typescript" });
      mockCommands.readFile.mockResolvedValue(content2);
      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "src/other.ts");
      });

      vi.clearAllMocks();

      // Re-open the first file
      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "src/file.ts");
      });

      expect(mockCommands.readFile).not.toHaveBeenCalled();
      expect(useFileStore.getState().activeFilePath).toBe("src/file.ts");
      expect(useFileStore.getState().openFiles).toHaveLength(2);
    });

    it("handles open file errors", async () => {
      mockCommands.readFile.mockRejectedValue(new Error("File not found"));

      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "missing.ts");
      });

      const state = useFileStore.getState();
      expect(state.openFiles).toHaveLength(0);
      expect(state.isFileLoading).toBe(false);
      expect(state.error).toBe("Error: File not found");
    });

    it("evicts oldest non-dirty file at MAX_OPEN_FILES", async () => {
      // Open 4 files (MAX_OPEN_FILES)
      for (let i = 0; i < 4; i++) {
        const filePath = `file${i}.ts`;
        mockCommands.readFile.mockResolvedValue(
          makeFileContent({ path: filePath, content: `content${i}` }),
        );
        await act(async () => {
          await useFileStore.getState().openFile(PROJECT_PATH, filePath);
        });
      }

      expect(useFileStore.getState().openFiles).toHaveLength(4);

      // Open a 5th file — should evict the oldest non-dirty file (file0.ts)
      mockCommands.readFile.mockResolvedValue(
        makeFileContent({ path: "file4.ts", content: "content4" }),
      );
      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "file4.ts");
      });

      const state = useFileStore.getState();
      expect(state.openFiles).toHaveLength(4);
      expect(state.openFiles.find((f) => f.path === "file0.ts")).toBeUndefined();
      expect(state.openFiles.find((f) => f.path === "file4.ts")).toBeDefined();
      expect(state.activeFilePath).toBe("file4.ts");
    });
  });

  // ── closeFile ───────────────────────────────────────────────────────

  describe("closeFile", () => {
    beforeEach(async () => {
      // Open three files: a.ts, b.ts, c.ts
      for (const name of ["a.ts", "b.ts", "c.ts"]) {
        mockCommands.readFile.mockResolvedValue(
          makeFileContent({ path: name, content: name }),
        );
        await act(async () => {
          await useFileStore.getState().openFile(PROJECT_PATH, name);
        });
      }
      // Active file is c.ts (last opened)
    });

    it("removes file from openFiles", () => {
      act(() => {
        useFileStore.getState().closeFile("b.ts");
      });

      const state = useFileStore.getState();
      expect(state.openFiles).toHaveLength(2);
      expect(state.openFiles.find((f) => f.path === "b.ts")).toBeUndefined();
    });

    it("activates neighbor when closing active file", () => {
      // c.ts is active (index 2); close it
      act(() => {
        useFileStore.getState().closeFile("c.ts");
      });

      const state = useFileStore.getState();
      expect(state.openFiles).toHaveLength(2);
      // Should activate the neighbor (b.ts, since c.ts was at end)
      expect(state.activeFilePath).toBe("b.ts");
    });

    it("sets activeFilePath to null when closing last file", () => {
      act(() => {
        useFileStore.getState().closeFile("a.ts");
      });
      act(() => {
        useFileStore.getState().closeFile("b.ts");
      });
      act(() => {
        useFileStore.getState().closeFile("c.ts");
      });

      expect(useFileStore.getState().openFiles).toHaveLength(0);
      expect(useFileStore.getState().activeFilePath).toBeNull();
    });

    it("does not change activeFilePath when closing non-active file", () => {
      // c.ts is active, close a.ts
      act(() => {
        useFileStore.getState().closeFile("a.ts");
      });

      expect(useFileStore.getState().activeFilePath).toBe("c.ts");
    });
  });

  // ── updateFileContent ───────────────────────────────────────────────

  describe("updateFileContent", () => {
    beforeEach(async () => {
      mockCommands.readFile.mockResolvedValue(
        makeFileContent({ path: "src/file.ts", content: "original" }),
      );
      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "src/file.ts");
      });
    });

    it("marks isDirty when content differs from original", () => {
      act(() => {
        useFileStore.getState().updateFileContent("src/file.ts", "modified");
      });

      const file = useFileStore.getState().openFiles[0];
      expect(file.content).toBe("modified");
      expect(file.isDirty).toBe(true);
    });

    it("clears isDirty when content matches originalContent", () => {
      // First make it dirty
      act(() => {
        useFileStore.getState().updateFileContent("src/file.ts", "modified");
      });
      expect(useFileStore.getState().openFiles[0].isDirty).toBe(true);

      // Revert to original
      act(() => {
        useFileStore.getState().updateFileContent("src/file.ts", "original");
      });
      expect(useFileStore.getState().openFiles[0].isDirty).toBe(false);
    });
  });

  // ── saveFile ────────────────────────────────────────────────────────

  describe("saveFile", () => {
    beforeEach(async () => {
      mockCommands.readFile.mockResolvedValue(
        makeFileContent({ path: "src/file.ts", content: "original" }),
      );
      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "src/file.ts");
      });
    });

    it("saves dirty file and resets isDirty", async () => {
      mockCommands.writeFile.mockResolvedValue(undefined);

      // Make dirty
      act(() => {
        useFileStore.getState().updateFileContent("src/file.ts", "updated content");
      });
      expect(useFileStore.getState().openFiles[0].isDirty).toBe(true);

      await act(async () => {
        await useFileStore.getState().saveFile(PROJECT_PATH, "src/file.ts");
      });

      const file = useFileStore.getState().openFiles[0];
      expect(file.isDirty).toBe(false);
      expect(file.originalContent).toBe("updated content");
      expect(useFileStore.getState().isSaving).toBe(false);
      expect(mockCommands.writeFile).toHaveBeenCalledWith(
        PROJECT_PATH,
        "src/file.ts",
        "updated content",
      );
    });

    it("skips save for non-dirty file", async () => {
      await act(async () => {
        await useFileStore.getState().saveFile(PROJECT_PATH, "src/file.ts");
      });

      expect(mockCommands.writeFile).not.toHaveBeenCalled();
    });

    it("handles save errors and preserves dirty state", async () => {
      mockCommands.writeFile.mockRejectedValue(new Error("Disk full"));

      // Make dirty
      act(() => {
        useFileStore.getState().updateFileContent("src/file.ts", "changed");
      });

      await act(async () => {
        await useFileStore.getState().saveFile(PROJECT_PATH, "src/file.ts");
      });

      const state = useFileStore.getState();
      expect(state.openFiles[0].isDirty).toBe(true);
      expect(state.isSaving).toBe(false);
      expect(state.error).toBe("Error: Disk full");
    });
  });

  // ── createEntry ─────────────────────────────────────────────────────

  describe("createEntry", () => {
    it("creates file and opens it", async () => {
      const newEntry = makeFileEntry({ name: "new.ts", path: "src/new.ts" });
      mockCommands.createFile.mockResolvedValue(newEntry);
      mockCommands.listDirectory.mockResolvedValue([...MOCK_SRC_ENTRIES, newEntry]);
      mockCommands.readFile.mockResolvedValue(
        makeFileContent({ path: "src/new.ts", content: "" }),
      );

      let result: string | null = null;
      await act(async () => {
        result = await useFileStore.getState().createEntry(PROJECT_PATH, "src", "new.ts", false);
      });

      expect(result).toBeNull();
      expect(mockCommands.createFile).toHaveBeenCalledWith(PROJECT_PATH, "src/new.ts");
      expect(useFileStore.getState().openFiles.find((f) => f.path === "src/new.ts")).toBeDefined();
      expect(useFileStore.getState().isMutating).toBe(false);
    });

    it("creates directory without opening", async () => {
      const newDir = makeDirEntry({ name: "components", path: "src/components" });
      mockCommands.createDirectory.mockResolvedValue(newDir);
      mockCommands.listDirectory.mockResolvedValue([...MOCK_SRC_ENTRIES, newDir]);

      let result: string | null = null;
      await act(async () => {
        result = await useFileStore.getState().createEntry(PROJECT_PATH, "src", "components", true);
      });

      expect(result).toBeNull();
      expect(mockCommands.createDirectory).toHaveBeenCalledWith(PROJECT_PATH, "src/components");
      expect(mockCommands.readFile).not.toHaveBeenCalled();
      expect(useFileStore.getState().isMutating).toBe(false);
    });

    it("returns error string on failure", async () => {
      mockCommands.createFile.mockRejectedValue(new Error("File already exists"));

      let result: string | null = null;
      await act(async () => {
        result = await useFileStore.getState().createEntry(PROJECT_PATH, "src", "dup.ts", false);
      });

      expect(result).toBe("Error: File already exists");
      expect(useFileStore.getState().error).toBe("Error: File already exists");
      expect(useFileStore.getState().isMutating).toBe(false);
    });
  });

  // ── deleteEntry ─────────────────────────────────────────────────────

  describe("deleteEntry", () => {
    it("deletes entry and closes related files", async () => {
      // Open the file first
      mockCommands.readFile.mockResolvedValue(
        makeFileContent({ path: "src/file.ts", content: "x" }),
      );
      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "src/file.ts");
      });
      expect(useFileStore.getState().openFiles).toHaveLength(1);

      mockCommands.deletePath.mockResolvedValue(undefined);
      mockCommands.listDirectory.mockResolvedValue([]);

      let result: string | null = null;
      await act(async () => {
        result = await useFileStore.getState().deleteEntry(PROJECT_PATH, "src/file.ts");
      });

      expect(result).toBeNull();
      expect(mockCommands.deletePath).toHaveBeenCalledWith(PROJECT_PATH, "src/file.ts");
      expect(useFileStore.getState().openFiles).toHaveLength(0);
      expect(useFileStore.getState().isMutating).toBe(false);
    });

    it("closes files inside deleted directory", async () => {
      // Open files inside a directory
      for (const name of ["src/a.ts", "src/b.ts"]) {
        mockCommands.readFile.mockResolvedValue(
          makeFileContent({ path: name, content: name }),
        );
        await act(async () => {
          await useFileStore.getState().openFile(PROJECT_PATH, name);
        });
      }

      // Also open a file outside the directory
      mockCommands.readFile.mockResolvedValue(
        makeFileContent({ path: "README.md", content: "readme" }),
      );
      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "README.md");
      });
      expect(useFileStore.getState().openFiles).toHaveLength(3);

      mockCommands.deletePath.mockResolvedValue(undefined);
      mockCommands.listDirectory.mockResolvedValue([]);

      await act(async () => {
        await useFileStore.getState().deleteEntry(PROJECT_PATH, "src");
      });

      const state = useFileStore.getState();
      // Only README.md should remain — src/a.ts and src/b.ts closed
      expect(state.openFiles).toHaveLength(1);
      expect(state.openFiles[0].path).toBe("README.md");
    });

    it("returns error string on failure", async () => {
      mockCommands.deletePath.mockRejectedValue(new Error("Access denied"));

      let result: string | null = null;
      await act(async () => {
        result = await useFileStore.getState().deleteEntry(PROJECT_PATH, "src/file.ts");
      });

      expect(result).toBe("Error: Access denied");
      expect(useFileStore.getState().error).toBe("Error: Access denied");
      expect(useFileStore.getState().isMutating).toBe(false);
    });
  });

  // ── renameEntry ─────────────────────────────────────────────────────

  describe("renameEntry", () => {
    it("renames file and updates open file path", async () => {
      // Open the file first
      mockCommands.readFile.mockResolvedValue(
        makeFileContent({ path: "src/old.ts", content: "code" }),
      );
      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "src/old.ts");
      });

      const renamedEntry = makeFileEntry({ name: "new.ts", path: "src/new.ts" });
      mockCommands.renamePath.mockResolvedValue(renamedEntry);
      mockCommands.listDirectory.mockResolvedValue([renamedEntry]);

      let result: string | null = null;
      await act(async () => {
        result = await useFileStore.getState().renameEntry(PROJECT_PATH, "src/old.ts", "new.ts");
      });

      expect(result).toBeNull();
      expect(mockCommands.renamePath).toHaveBeenCalledWith(PROJECT_PATH, "src/old.ts", "src/new.ts");

      const state = useFileStore.getState();
      expect(state.openFiles[0].path).toBe("src/new.ts");
      expect(state.openFiles[0].name).toBe("new.ts");
      expect(state.isMutating).toBe(false);
    });

    it("updates activeFilePath when renamed file was active", async () => {
      mockCommands.readFile.mockResolvedValue(
        makeFileContent({ path: "src/active.ts", content: "c" }),
      );
      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "src/active.ts");
      });
      expect(useFileStore.getState().activeFilePath).toBe("src/active.ts");

      mockCommands.renamePath.mockResolvedValue(
        makeFileEntry({ name: "renamed.ts", path: "src/renamed.ts" }),
      );
      mockCommands.listDirectory.mockResolvedValue([]);

      await act(async () => {
        await useFileStore.getState().renameEntry(PROJECT_PATH, "src/active.ts", "renamed.ts");
      });

      expect(useFileStore.getState().activeFilePath).toBe("src/renamed.ts");
    });

    it("updates paths of files inside renamed directory", async () => {
      // Open files inside src/old-dir/
      for (const path of ["src/old-dir/a.ts", "src/old-dir/b.ts"]) {
        mockCommands.readFile.mockResolvedValue(
          makeFileContent({ path, content: "code" }),
        );
        await act(async () => {
          await useFileStore.getState().openFile(PROJECT_PATH, path);
        });
      }

      mockCommands.renamePath.mockResolvedValue(
        makeDirEntry({ name: "new-dir", path: "src/new-dir" }),
      );
      mockCommands.listDirectory.mockResolvedValue([]);

      await act(async () => {
        await useFileStore.getState().renameEntry(PROJECT_PATH, "src/old-dir", "new-dir");
      });

      const state = useFileStore.getState();
      const paths = state.openFiles.map((f) => f.path);
      expect(paths).toContain("src/new-dir/a.ts");
      expect(paths).toContain("src/new-dir/b.ts");
      expect(paths).not.toContain("src/old-dir/a.ts");
      expect(paths).not.toContain("src/old-dir/b.ts");
    });

    it("returns error string on failure", async () => {
      mockCommands.renamePath.mockRejectedValue(new Error("Name conflict"));

      let result: string | null = null;
      await act(async () => {
        result = await useFileStore.getState().renameEntry(PROJECT_PATH, "src/file.ts", "dup.ts");
      });

      expect(result).toBe("Error: Name conflict");
      expect(useFileStore.getState().error).toBe("Error: Name conflict");
      expect(useFileStore.getState().isMutating).toBe(false);
    });
  });

  // ── copyExternalEntriesToTree ───────────────────────────────────────

  describe("copyExternalEntriesToTree", () => {
    it("copies entries and refreshes target directory", async () => {
      const copyResult: CopyResult = {
        entries: [makeFileEntry({ name: "copied.ts", path: "src/copied.ts" })],
        skipped: [],
        totalBytesCopied: 2048,
      };
      mockCommands.copyExternalEntries.mockResolvedValue(copyResult);
      mockCommands.listDirectory.mockResolvedValue(MOCK_SRC_ENTRIES);

      let result: CopyResult | null = null;
      await act(async () => {
        result = await useFileStore.getState().copyExternalEntriesToTree(
          PROJECT_PATH,
          "src",
          ["/external/copied.ts"],
          "skip",
        );
      });

      expect(result).toEqual(copyResult);
      expect(mockCommands.copyExternalEntries).toHaveBeenCalledWith(
        PROJECT_PATH,
        "src",
        ["/external/copied.ts"],
        "skip",
      );
      expect(mockCommands.listDirectory).toHaveBeenCalledWith(PROJECT_PATH, "src");
      expect(useFileStore.getState().isMutating).toBe(false);
      expect(useFileStore.getState().error).toBeNull();
    });

    it("sets error when some files are skipped", async () => {
      const copyResult: CopyResult = {
        entries: [],
        skipped: ["file1.ts", "file2.ts"],
        totalBytesCopied: 0,
      };
      mockCommands.copyExternalEntries.mockResolvedValue(copyResult);
      mockCommands.listDirectory.mockResolvedValue([]);

      await act(async () => {
        await useFileStore.getState().copyExternalEntriesToTree(
          PROJECT_PATH,
          "src",
          ["/ext/file1.ts", "/ext/file2.ts"],
          "skip",
        );
      });

      expect(useFileStore.getState().error).toBe(
        "2 file(s) skipped (already exist or symlinks)",
      );
    });

    it("returns null and sets error on failure", async () => {
      mockCommands.copyExternalEntries.mockRejectedValue(new Error("Copy failed"));

      let result: CopyResult | null = null;
      await act(async () => {
        result = await useFileStore.getState().copyExternalEntriesToTree(
          PROJECT_PATH,
          "src",
          ["/ext/file.ts"],
          "overwrite",
        );
      });

      expect(result).toBeNull();
      expect(useFileStore.getState().error).toBe("Error: Copy failed");
      expect(useFileStore.getState().isMutating).toBe(false);
    });
  });

  // ── startInlineCreate / cancelInlineCreate ──────────────────────────

  describe("startInlineCreate / cancelInlineCreate", () => {
    it("sets inlineCreate state and expands parent dir", () => {
      act(() => {
        useFileStore.getState().startInlineCreate(PROJECT_PATH, "src", false);
      });

      const tree = useFileStore.getState().getTreeState(PROJECT_PATH);
      expect(tree.inlineCreate).toEqual({ parentDir: "src", isDir: false });
      expect(tree.expandedDirs["src"]).toBe(true);
    });

    it("clears inlineCreate on cancel", () => {
      // Set up inline create first
      act(() => {
        useFileStore.getState().startInlineCreate(PROJECT_PATH, "src", true);
      });
      expect(useFileStore.getState().getTreeState(PROJECT_PATH).inlineCreate).not.toBeNull();

      act(() => {
        useFileStore.getState().cancelInlineCreate(PROJECT_PATH);
      });

      expect(useFileStore.getState().getTreeState(PROJECT_PATH).inlineCreate).toBeNull();
    });
  });

  // ── Computed ────────────────────────────────────────────────────────

  describe("computed", () => {
    it("getActiveFile returns the active open file", async () => {
      mockCommands.readFile.mockResolvedValue(
        makeFileContent({ path: "src/file.ts", content: "code" }),
      );
      await act(async () => {
        await useFileStore.getState().openFile(PROJECT_PATH, "src/file.ts");
      });

      const activeFile = useFileStore.getState().getActiveFile();
      expect(activeFile).toBeDefined();
      expect(activeFile?.path).toBe("src/file.ts");
      expect(activeFile?.content).toBe("code");
    });

    it("getTreeState returns empty tree for unknown project", () => {
      const tree = useFileStore.getState().getTreeState("/nonexistent/project");
      expect(tree.entries).toEqual({});
      expect(tree.expandedDirs).toEqual({});
      expect(tree.loadingDirs).toEqual({});
      expect(tree.inlineCreate).toBeNull();
    });

    it("getFilteredEntries filters files by name", async () => {
      mockCommands.listDirectory.mockResolvedValue([
        makeFileEntry({ name: "index.ts", path: "src/index.ts" }),
        makeFileEntry({ name: "app.tsx", path: "src/app.tsx" }),
        makeFileEntry({ name: "utils.ts", path: "src/utils.ts" }),
        makeDirEntry({ name: "components", path: "src/components" }),
      ]);

      await act(async () => {
        await useFileStore.getState().loadDirectory(PROJECT_PATH, "src");
      });

      // Filter for files containing "app"
      const results = useFileStore.getState().getFilteredEntries(PROJECT_PATH, "app");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("app.tsx");

      // Filter for files containing "ts" — should match index.ts and utils.ts (but not dirs)
      const tsResults = useFileStore.getState().getFilteredEntries(PROJECT_PATH, "ts");
      expect(tsResults).toHaveLength(3); // index.ts, app.tsx, utils.ts all contain "ts"

      // Empty query returns empty array
      const emptyResults = useFileStore.getState().getFilteredEntries(PROJECT_PATH, "");
      expect(emptyResults).toHaveLength(0);
    });
  });

  // ── reset ───────────────────────────────────────────────────────────

  describe("reset", () => {
    it("resets to initial state", async () => {
      // Load some data
      mockCommands.listDirectory.mockResolvedValue(MOCK_ENTRIES);
      mockCommands.readFile.mockResolvedValue(
        makeFileContent({ path: "src/file.ts" }),
      );

      await act(async () => {
        await useFileStore.getState().loadDirectory(PROJECT_PATH, "");
        await useFileStore.getState().openFile(PROJECT_PATH, "src/file.ts");
      });

      // Verify state is populated
      expect(useFileStore.getState().openFiles).toHaveLength(1);
      expect(Object.keys(useFileStore.getState().treeByProject)).toHaveLength(1);

      // Reset
      act(() => {
        useFileStore.getState().reset();
      });

      const state = useFileStore.getState();
      expect(state.treeByProject).toEqual({});
      expect(state.openFiles).toEqual([]);
      expect(state.activeFilePath).toBeNull();
      expect(state.isFileLoading).toBe(false);
      expect(state.isSaving).toBe(false);
      expect(state.isMutating).toBe(false);
      expect(state.error).toBeNull();
      expect(state.pendingScrollTarget).toBeNull();
    });
  });
});
