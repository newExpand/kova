import { motion } from "motion/react";
import { X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useFileStore } from "../stores/fileStore";

export function FileTabs() {
  const { openFiles, activeFilePath, setActiveFile, closeFile } = useFileStore(
    useShallow((s) => ({
      openFiles: s.openFiles,
      activeFilePath: s.activeFilePath,
      setActiveFile: s.setActiveFile,
      closeFile: s.closeFile,
    })),
  );

  if (openFiles.length === 0) return null;

  return (
    <div className="flex h-7 items-center gap-1 border-b border-white/[0.06] px-2">
      {openFiles.map((file) => {
        const isActive = file.path === activeFilePath;
        return (
          <button
            key={file.path}
            type="button"
            onClick={() => setActiveFile(file.path)}
            className={`group relative flex h-6 items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${
              isActive ? "text-text" : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {isActive && (
              <motion.div
                layoutId="file-tab-pill"
                className="absolute inset-0 rounded-md bg-white/[0.12]"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10 max-w-[120px] truncate">
              {file.name}
            </span>
            <span
              role="button"
              tabIndex={-1}
              className="relative z-10 flex items-center"
              onClick={(e) => {
                e.stopPropagation();
                closeFile(file.path);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  closeFile(file.path);
                }
              }}
            >
              {file.isDirty ? (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              ) : (
                <X className="h-3 w-3 text-text-muted opacity-0 group-hover:opacity-100 hover:text-text" />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
