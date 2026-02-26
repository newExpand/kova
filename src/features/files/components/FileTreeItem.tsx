import { ChevronRight, Folder, File } from "lucide-react";
import { motion } from "motion/react";
import type { FileEntry } from "../../../lib/tauri/commands";

interface FileTreeItemProps {
  entry: FileEntry;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  isActive: boolean;
  onToggle: () => void;
  onClick: () => void;
}

export function FileTreeItem({
  entry,
  depth,
  isExpanded,
  isLoading,
  isActive,
  onToggle,
  onClick,
}: FileTreeItemProps) {
  const paddingLeft = depth * 16 + 8;

  const handleClick = () => {
    if (entry.isDir) {
      onToggle();
    } else {
      onClick();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`relative flex w-full items-center gap-1.5 py-[3px] text-left text-[12px] transition-colors hover:bg-white/[0.06] ${
        isActive ? "text-text" : "text-text-secondary"
      }`}
      style={{ paddingLeft }}
    >
      {isActive && (
        <motion.div
          layoutId="activeFileBg"
          className="absolute inset-0 z-0 rounded-sm bg-white/[0.10]"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
      {entry.isDir ? (
        <>
          <ChevronRight
            className={`relative h-3 w-3 shrink-0 text-text-muted transition-transform duration-150 ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
          <Folder className="relative h-3.5 w-3.5 shrink-0 text-text-muted" />
        </>
      ) : (
        <>
          <span className="relative inline-block w-3 shrink-0" />
          <File className="relative h-3.5 w-3.5 shrink-0 text-text-muted" />
        </>
      )}
      <span className="relative truncate">
        {entry.name}
        {isLoading && (
          <span className="ml-1 text-[10px] text-text-muted animate-pulse">...</span>
        )}
      </span>
    </button>
  );
}
