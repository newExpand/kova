import { useState, useCallback, useRef, useEffect } from "react";

interface UseResizeHandleOptions {
  initialWidth: number;
  minWidth: number;
  maxWidth: number;
}

interface UseResizeHandleReturn {
  width: number;
  handleMouseDown: (e: React.MouseEvent) => void;
}

export function useResizeHandle({
  initialWidth,
  minWidth,
  maxWidth,
}: UseResizeHandleOptions): UseResizeHandleReturn {
  const [width, setWidth] = useState(initialWidth);
  const isResizing = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Cleanup on unmount to prevent leaked listeners + stuck cursor
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;

      const startX = e.clientX;
      const startWidth = width;

      function cleanup() {
        isResizing.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        cleanupRef.current = null;
      }

      function handleMouseMove(ev: MouseEvent) {
        if (!isResizing.current) return;
        const delta = ev.clientX - startX;
        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
        setWidth(newWidth);
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
    // width is captured in closure via startWidth — intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, minWidth, maxWidth],
  );

  return { width, handleMouseDown };
}
