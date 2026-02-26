import { useEffect } from "react";
import { X, Folder } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useProjectStore } from "../../features/project";
import { useResizeHandle } from "../../hooks/useResizeHandle";
import { FileTree, FileTabs, FileBreadcrumb, CodeViewer } from "../../features/files";

const MIN_TREE_WIDTH = 160;
const MAX_TREE_WIDTH = 280;
const DEFAULT_TREE_WIDTH = 200;

export default function FileViewerPanel() {
  const close = useAppStore((s) => s.setFileViewerPanelOpen);
  const project = useProjectStore((s) => {
    const id = s.selectedId;
    return id ? s.projects.find((p) => p.id === id) : undefined;
  });

  const { width: treeWidth, handleMouseDown: handleTreeResize } = useResizeHandle({
    initialWidth: DEFAULT_TREE_WIDTH,
    minWidth: MIN_TREE_WIDTH,
    maxWidth: MAX_TREE_WIDTH,
  });

  // Auto-close when project disappears (e.g. deselected or deleted)
  useEffect(() => {
    if (!project) {
      close(false);
    }
  }, [project, close]);

  // Escape key to close (respects modal stacking)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) {
        // Don't close if a higher-priority overlay (e.g. CommandPalette) is open
        const dialog = document.querySelector("[data-radix-dialog-overlay]");
        if (dialog) return;
        e.preventDefault();
        close(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  if (!project) return null;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="flex h-[38px] shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-1.5">
          <Folder className="h-3.5 w-3.5 text-text-muted" />
          <span className="text-xs font-medium text-text-secondary truncate">
            {project.name}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-muted">⌘\</span>
          <button
            type="button"
            onClick={() => close(false)}
            className="rounded p-1 text-text-muted hover:bg-white/[0.06] hover:text-text transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tree */}
        <div
          className="flex flex-col border-r border-white/[0.06] overflow-hidden glass-scrollbar"
          style={{ width: treeWidth, minWidth: MIN_TREE_WIDTH }}
        >
          <FileTree projectPath={project.path} />
        </div>

        {/* Resize handle */}
        <div
          className="w-1 cursor-col-resize hover:bg-white/[0.06] transition-colors flex-shrink-0"
          onMouseDown={handleTreeResize}
        />

        {/* Viewer */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <FileTabs />
          <FileBreadcrumb projectPath={project.path} />
          <CodeViewer projectPath={project.path} />
        </div>
      </div>
    </div>
  );
}
