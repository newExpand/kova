import { ChevronRight } from "lucide-react";
import { useFileStore } from "../stores/fileStore";

interface FileBreadcrumbProps {
  projectPath: string;
}

export function FileBreadcrumb({ projectPath }: FileBreadcrumbProps) {
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const toggleDirectory = useFileStore((s) => s.toggleDirectory);

  if (!activeFilePath) return null;

  const segments = activeFilePath.split("/");

  const handleSegmentClick = (index: number) => {
    // Build directory path from segments up to this index
    const dirPath = segments.slice(0, index + 1).join("/");
    toggleDirectory(projectPath, dirPath);
  };

  return (
    <div className="flex h-7 items-center gap-0.5 border-b border-white/[0.06] px-3 text-xs">
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex items-center gap-0.5">
            {i > 0 && (
              <ChevronRight className="h-2.5 w-2.5 text-text-muted" />
            )}
            {isLast ? (
              <span className="text-text">{segment}</span>
            ) : (
              <button
                type="button"
                onClick={() => handleSegmentClick(i)}
                className="text-text-muted transition-colors hover:text-text-secondary"
              >
                {segment}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
