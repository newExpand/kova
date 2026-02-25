import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useFileStore } from "../stores/fileStore";
import { FileTreeItem } from "./FileTreeItem";
import type { FileEntry } from "../../../lib/tauri/commands";

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

  // Load root on mount
  useEffect(() => {
    if (!tree.entries[""] && !tree.entries["."] && !tree.loadingDirs[""]) {
      loadDirectory(projectPath, "");
    }
  }, [projectPath, loadDirectory, tree.entries, tree.loadingDirs]);

  const rootEntries = tree.entries[""] ?? tree.entries["."] ?? [];

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
      {rootEntries.length === 0 && !tree.loadingDirs[""] ? (
        <div className="px-3 py-2 text-xs text-text-muted">Empty</div>
      ) : (
        <TreeEntries
          entries={rootEntries}
          depth={0}
          projectPath={projectPath}
          tree={tree}
          activeFilePath={activeFilePath}
          onToggle={toggleDirectory}
          onOpenFile={openFile}
        />
      )}
    </div>
  );
}

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
            {entry.isDir && isExpanded && children.length > 0 && (
              <TreeEntries
                entries={children}
                depth={depth + 1}
                projectPath={projectPath}
                tree={tree}
                activeFilePath={activeFilePath}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
