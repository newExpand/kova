import { useRef, useEffect } from "react";
import { motion, LayoutGroup } from "motion/react";
import { useProjectStore } from "../../project/stores/projectStore";
import { useFileStore } from "../stores/fileStore";
import { useResizeHandle } from "../../../hooks/useResizeHandle";
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

  const openFileCount = useFileStore((s) => s.openFiles.length);

  const { width: treeWidth, handleMouseDown } = useResizeHandle({
    initialWidth: DEFAULT_TREE_WIDTH,
    minWidth: MIN_TREE_WIDTH,
    maxWidth: MAX_TREE_WIDTH,
  });

  const hasAnimatedIn = useRef(false);

  // Only animate on first file open (0 -> 1 transition)
  const shouldAnimate = !hasAnimatedIn.current && openFileCount > 0;

  useEffect(() => {
    if (openFileCount > 0) {
      hasAnimatedIn.current = true;
    }
  }, [openFileCount]);

  if (!project || !isActive) return null;

  return (
    <LayoutGroup id="files-main">
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

        {/* Right Panel — slides in on first file open */}
        <motion.div
          className="flex flex-1 flex-col overflow-hidden"
          initial={shouldAnimate ? { x: 40, opacity: 0 } : false}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <FileTabs />
          <FileBreadcrumb projectPath={project.path} />
          <CodeViewer projectPath={project.path} />
        </motion.div>
      </div>
    </LayoutGroup>
  );
}
