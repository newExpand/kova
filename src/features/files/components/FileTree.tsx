import { useEffect, useState, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { motion, AnimatePresence } from "motion/react";
import { Search, X } from "lucide-react";
import { useFileStore } from "../stores/fileStore";
import { FileTreeItem } from "./FileTreeItem";
import type { FileEntry } from "../../../lib/tauri/commands";

const DIR_EXPAND_TRANSITION = {
  height: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
  opacity: { duration: 0.2, delay: 0.05 },
} as const;

interface FileTreeProps {
  projectPath: string;
}

export function FileTree({ projectPath }: FileTreeProps) {
  const { loadDirectory, toggleDirectory, openFile, activeFilePath } =
    useFileStore(
      useShallow((s) => ({
        loadDirectory: s.loadDirectory,
        toggleDirectory: s.toggleDirectory,
        openFile: s.openFile,
        activeFilePath: s.activeFilePath,
      })),
    );

  const tree = useFileStore((s) => s.getTreeState(projectPath));
  const getFilteredEntries = useFileStore((s) => s.getFilteredEntries);

  // Search is fully local per FileTree instance (no store pollution)
  const [localQuery, setLocalQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(localQuery);
    }, 150);
    return () => clearTimeout(timer);
  }, [localQuery]);

  const handleClear = useCallback(() => {
    setLocalQuery("");
    setDebouncedQuery("");
  }, []);

  // Load root on mount
  useEffect(() => {
    if (!tree.entries[""] && !tree.entries["."] && !tree.loadingDirs[""]) {
      loadDirectory(projectPath, "");
    }
  }, [projectPath, loadDirectory, tree.entries, tree.loadingDirs]);

  const rootEntries = tree.entries[""] ?? tree.entries["."] ?? [];
  const isSearching = debouncedQuery.trim().length > 0;
  const filteredEntries = isSearching ? getFilteredEntries(projectPath, debouncedQuery) : [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search */}
      <div className="flex items-center gap-1.5 px-2 py-1">
        <div className="glass-inset flex h-7 flex-1 items-center gap-1.5 rounded-md px-2">
          <Search className="h-3 w-3 shrink-0 text-text-muted" />
          <input
            type="text"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            placeholder="Search files..."
            className="flex-1 bg-transparent text-[12px] text-text placeholder:text-text-muted outline-none"
          />
          {localQuery && (
            <button
              type="button"
              onClick={handleClear}
              className="shrink-0 text-text-muted hover:text-text transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tree or Search Results */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        <FileTreeContent
          isSearching={isSearching}
          filteredEntries={filteredEntries}
          rootEntries={rootEntries}
          isRootEmpty={rootEntries.length === 0 && !tree.loadingDirs[""]}
          projectPath={projectPath}
          tree={tree}
          activeFilePath={activeFilePath}
          onToggle={toggleDirectory}
          onOpenFile={openFile}
        />
      </div>
    </div>
  );
}

// ── Extracted to avoid nested ternary in FileTree render ──

interface FileTreeContentProps {
  isSearching: boolean;
  filteredEntries: FileEntry[];
  rootEntries: FileEntry[];
  isRootEmpty: boolean;
  projectPath: string;
  tree: ReturnType<ReturnType<typeof useFileStore.getState>["getTreeState"]>;
  activeFilePath: string | null;
  onToggle: (projectPath: string, relativePath: string) => void;
  onOpenFile: (projectPath: string, relativePath: string) => Promise<void>;
}

function FileTreeContent({
  isSearching,
  filteredEntries,
  rootEntries,
  isRootEmpty,
  projectPath,
  tree,
  activeFilePath,
  onToggle,
  onOpenFile,
}: FileTreeContentProps) {
  if (isSearching) {
    if (filteredEntries.length === 0) {
      return <div className="px-3 py-2 text-xs text-text-muted">No matches in loaded folders</div>;
    }
    return (
      <>
        {filteredEntries.map((entry) => (
          <FileTreeItem
            key={entry.path}
            entry={entry}
            depth={0}
            isExpanded={false}
            isLoading={false}
            isActive={activeFilePath === entry.path}
            onToggle={() => {}}
            onClick={() => onOpenFile(projectPath, entry.path)}
          />
        ))}
      </>
    );
  }

  if (isRootEmpty) {
    return <div className="px-3 py-2 text-xs text-text-muted">Empty</div>;
  }

  return (
    <TreeEntries
      entries={rootEntries}
      depth={0}
      projectPath={projectPath}
      tree={tree}
      activeFilePath={activeFilePath}
      onToggle={onToggle}
      onOpenFile={onOpenFile}
    />
  );
}

// ── Recursive tree renderer ──

interface TreeEntriesProps {
  entries: FileEntry[];
  depth: number;
  projectPath: string;
  tree: ReturnType<ReturnType<typeof useFileStore.getState>["getTreeState"]>;
  activeFilePath: string | null;
  onToggle: (projectPath: string, relativePath: string) => void;
  onOpenFile: (projectPath: string, relativePath: string) => Promise<void>;
}

function TreeEntries({
  entries,
  depth,
  projectPath,
  tree,
  activeFilePath,
  onToggle,
  onOpenFile,
}: TreeEntriesProps) {
  return (
    <>
      {entries.map((entry) => {
        const isExpanded = tree.expandedDirs[entry.path] ?? false;
        const isLoading = tree.loadingDirs[entry.path] ?? false;
        const children = tree.entries[entry.path] ?? [];

        return (
          <div key={entry.path}>
            <FileTreeItem
              entry={entry}
              depth={depth}
              isExpanded={isExpanded}
              isLoading={isLoading}
              isActive={!entry.isDir && activeFilePath === entry.path}
              onToggle={() => onToggle(projectPath, entry.path)}
              onClick={() => onOpenFile(projectPath, entry.path)}
            />
            {entry.isDir && (
              <AnimatePresence initial={false}>
                {isExpanded && children.length > 0 && (
                  <motion.div
                    key={entry.path}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={DIR_EXPAND_TRANSITION}
                    style={{ overflow: "hidden" }}
                  >
                    <TreeEntries
                      entries={children}
                      depth={depth + 1}
                      projectPath={projectPath}
                      tree={tree}
                      activeFilePath={activeFilePath}
                      onToggle={onToggle}
                      onOpenFile={onOpenFile}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        );
      })}
    </>
  );
}
