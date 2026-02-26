import { useCallback, useRef, useEffect, useState } from "react";

interface UseSplitPanelResizeOptions {
  panelWidth: number;
  onWidthChange: (width: number) => void;
  minPanelWidth: number;
  minContentWidth: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface UseSplitPanelResizeReturn {
  handleMouseDown: (e: React.MouseEvent) => void;
  isResizing: boolean;
}

export function useSplitPanelResize({
  panelWidth,
  onWidthChange,
  minPanelWidth,
  minContentWidth,
  containerRef,
}: UseSplitPanelResizeOptions): UseSplitPanelResizeReturn {
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      // Guard: clean up any in-progress resize before starting a new one
      cleanupRef.current?.();
      isResizingRef.current = true;
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = panelWidth;

      function cleanup() {
        isResizingRef.current = false;
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        cleanupRef.current = null;
      }

      function handleMouseMove(ev: MouseEvent) {
        if (!isResizingRef.current) return;
        const container = containerRef.current;
        if (!container) {
          cleanup();
          return;
        }
        // Right-side panel: dragging left increases panel width
        const delta = startX - ev.clientX;
        const maxPanelWidth = container.clientWidth - minContentWidth;
        const newWidth = Math.min(maxPanelWidth, Math.max(minPanelWidth, startWidth + delta));
        onWidthChange(newWidth);
      }

      function handleMouseUp() {
        cleanup();
      }

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      cleanupRef.current = cleanup;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panelWidth, minPanelWidth, minContentWidth, onWidthChange, containerRef],
  );

  return { handleMouseDown, isResizing };
}
