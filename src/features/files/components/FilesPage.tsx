import { useState, useCallback, useRef } from "react";
import { useProjectStore } from "../../project/stores/projectStore";
import { FileTree } from "./FileTree";
import { FileTabs } from "./FileTabs";
import { FileBreadcrumb } from "./FileBreadcrumb";
import { CodeViewer } from "./CodeViewer";
import { Folder } from "lucide-react";

interface FilesPageProps {
  projectId: string;
  isActive: boolean;
}

const MIN_TREE_WIDTH = 180;
const MAX_TREE_WIDTH = 400;
const DEFAULT_TREE_WIDTH = 240;

export default function FilesPage({ projectId, isActive }: FilesPageProps) {
  const project = useProjectStore((s) =>
    s.projects.find((p) => p.id === projectId),
  );

  const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH);
  const isResizing = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;

    const startX = e.clientX;
    const startWidth = treeWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = ev.clientX - startX;
      const newWidth = Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, startWidth + delta));
      setTreeWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeWidth]);

  if (!project || !isActive) return null;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* File Tree */}
      <div
        className="flex flex-col border-r border-white/[0.06] overflow-hidden"
        style={{ width: treeWidth, minWidth: MIN_TREE_WIDTH }}
      >
        <div className="flex h-7 items-center gap-1.5 border-b border-white/[0.06] px-3">
          <Folder className="h-3.5 w-3.5 text-text-muted" />
          <span className="text-xs font-medium text-text-secondary truncate">
            {project.name}
          </span>
        </div>
        <FileTree projectPath={project.path} />
      </div>

      {/* Resize Handle */}
      <div
        className="w-1 cursor-col-resize hover:bg-white/[0.06] transition-colors flex-shrink-0"
        onMouseDown={handleMouseDown}
      />

      {/* Right Panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <FileTabs />
        <FileBreadcrumb projectPath={project.path} />
        <CodeViewer projectPath={project.path} />
      </div>
    </div>
  );
}
