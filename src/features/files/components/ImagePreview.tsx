import { useState } from "react";
import { ImageOff } from "lucide-react";
import { getAssetUrl } from "../../../lib/tauri/commands";

interface ImagePreviewProps {
  projectPath: string;
  relativePath: string;
  fileName: string;
}

export function ImagePreview({ projectPath, relativePath, fileName }: ImagePreviewProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);

  if (status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted">
        <ImageOff className="h-8 w-8 opacity-30" />
        <span className="text-sm">Failed to load image</span>
        <span className="text-xs opacity-60 max-w-[300px] truncate" title={relativePath}>
          {relativePath}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="relative flex flex-1 items-center justify-center overflow-auto p-4 checkerboard">
        {status === "loading" && (
          <span className="absolute text-sm text-text-muted animate-pulse">Loading...</span>
        )}
        <img
          src={getAssetUrl(projectPath, relativePath)}
          alt={fileName}
          onLoad={(e) => {
            const img = e.currentTarget;
            setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
            setStatus("loaded");
          }}
          onError={() => {
            console.error("[ImagePreview] Failed to load:", relativePath);
            setStatus("error");
          }}
          className="max-h-full max-w-full object-contain"
          style={{ display: status === "loading" ? "none" : "block" }}
          draggable={false}
        />
      </div>

      {/* Info bar */}
      {status === "loaded" && dimensions && (
        <div className="flex shrink-0 items-center gap-3 border-t border-white/[0.06] px-3 py-1.5 text-[11px] text-text-muted">
          <span>{fileName}</span>
          <span className="opacity-60">|</span>
          <span>{dimensions.w} × {dimensions.h}</span>
        </div>
      )}
    </div>
  );
}
