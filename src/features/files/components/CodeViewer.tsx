import { useShallow } from "zustand/react/shallow";
import { File } from "lucide-react";
import { useFileStore } from "../stores/fileStore";
import { useCodeMirror } from "../hooks/useCodeMirror";

interface CodeViewerProps {
  projectPath: string;
}

export function CodeViewer({ projectPath }: CodeViewerProps) {
  const { activeFile, updateFileContent, saveFile, isFileLoading, pendingScrollTarget, clearScrollTarget } =
    useFileStore(
      useShallow((s) => ({
        activeFile: s.getActiveFile(),
        updateFileContent: s.updateFileContent,
        saveFile: s.saveFile,
        isFileLoading: s.isFileLoading,
        pendingScrollTarget: s.pendingScrollTarget,
        clearScrollTarget: s.clearScrollTarget,
      })),
    );

  // Only pass scroll target if it matches the active file
  const scrollTarget =
    pendingScrollTarget && activeFile && pendingScrollTarget.path === activeFile.path
      ? pendingScrollTarget
      : null;

  const { containerRef } = useCodeMirror({
    content: activeFile?.content ?? "",
    fileName: activeFile?.name ?? "",
    readOnly: activeFile?.isBinary ?? false,
    onChange: (content) => {
      if (activeFile) {
        updateFileContent(activeFile.path, content);
      }
    },
    onSave: () => {
      if (activeFile) {
        saveFile(projectPath, activeFile.path);
      }
    },
    scrollTarget,
    onScrollTargetConsumed: clearScrollTarget,
    projectPath,
    currentFilePath: activeFile?.path,
  });

  if (isFileLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-muted">
        <span className="animate-pulse text-sm">Loading...</span>
      </div>
    );
  }

  if (!activeFile) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-text-muted">
        <File className="h-8 w-8 opacity-30" />
        <span className="text-sm">Select a file to view</span>
      </div>
    );
  }

  if (activeFile.isBinary) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-text-muted">
        <File className="h-8 w-8 opacity-30" />
        <span className="text-sm">Binary file — cannot display</span>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      {activeFile.isDirty && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary z-10" />
      )}
      <div ref={containerRef} className="h-full overflow-auto glass-scrollbar" />
    </div>
  );
}
