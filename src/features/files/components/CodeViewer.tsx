import { useState, useEffect, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { File } from "lucide-react";
import { useFileStore } from "../stores/fileStore";
import { useCodeMirror } from "../hooks/useCodeMirror";
import { FileBreadcrumb } from "./FileBreadcrumb";
import { useAgentFileTrackingStore } from "../stores/agentFileTrackingStore";
import { getFileDiff } from "../../../lib/tauri/commands";

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

  // Always-on diff
  const [diffPatch, setDiffPatch] = useState<string | null>(null);

  const fetchDiff = useCallback(async () => {
    if (!activeFile) {
      setDiffPatch(null);
      return;
    }
    try {
      const diff = await getFileDiff(projectPath, activeFile.path);
      setDiffPatch(diff?.patch ?? null);
      // Clear edit tracking if no more git changes
      if (!diff) {
        const tracking = useAgentFileTrackingStore.getState();
        tracking.removeUserEdit(projectPath, activeFile.path);
        tracking.removeAgentWrite(projectPath, activeFile.path);
      }
    } catch (e) {
      console.error("[CodeViewer] Failed to fetch diff for", activeFile.path, e);
      setDiffPatch(null);
    }
  }, [activeFile?.path, projectPath]);

  // Fetch diff on file open/switch, dirty→clean (save/undo), or external refresh (agent edit)
  const prevRef = useRef<{ path?: string; isDirty?: boolean; originalContent?: string }>({});
  useEffect(() => {
    const prev = prevRef.current;
    const pathChanged = prev.path !== activeFile?.path;
    const dirtyToClean = !pathChanged && prev.isDirty === true && activeFile?.isDirty === false;
    const externalRefresh = !pathChanged
      && prev.originalContent !== undefined
      && prev.originalContent !== activeFile?.originalContent;

    if (pathChanged || dirtyToClean || externalRefresh) {
      fetchDiff();
    }
    prevRef.current = {
      path: activeFile?.path,
      isDirty: activeFile?.isDirty,
      originalContent: activeFile?.originalContent,
    };
  }, [activeFile?.path, activeFile?.isDirty, activeFile?.originalContent, fetchDiff]);

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
    diffPatch,
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
    <>
      <FileBreadcrumb projectPath={projectPath} />
      <div className="relative flex-1 overflow-hidden">
        {activeFile.isDirty && (
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary z-10" />
        )}
        <div ref={containerRef} className="h-full overflow-auto glass-scrollbar" />
      </div>
    </>
  );
}
