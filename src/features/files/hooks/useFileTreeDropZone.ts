import { useEffect, useRef, useState, type RefObject } from "react";
import { useFileStore } from "../stores/fileStore";

// ─── Types ──────────────────────────────────────────────────────────────────

interface UseFileTreeDropZoneOptions {
  projectPath: string;
  containerRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
}

export interface DropZoneState {
  isDragOver: boolean;
  targetDirPath: string | null;
  /** Number of files being dragged (from enter event) */
  fileCount: number;
  /** Error message from a failed drop operation */
  dropError: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Throttle interval for `over` events (ms) — ~60fps */
const OVER_THROTTLE_MS = 16;

/** Dedup window for duplicate drop events (see https://github.com/tauri-apps/tauri/issues/14134) */
const DROP_DEDUP_MS = 100;

/** Initial / reset drop zone state */
const IDLE_STATE: DropZoneState = {
  isDragOver: false,
  targetDirPath: null,
  fileCount: 0,
  dropError: null,
};

/** Duration to show a drop error before auto-clearing (ms) */
const DROP_ERROR_DISPLAY_MS = 4000;

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useFileTreeDropZone(
  options: UseFileTreeDropZoneOptions,
): DropZoneState {
  const { projectPath, containerRef, enabled } = options;

  const [state, setState] = useState<DropZoneState>(IDLE_STATE);

  // Refs for mutable state that shouldn't trigger re-renders
  const cachedPathsRef = useRef<string[]>([]);
  const lastOverTimeRef = useRef(0);
  const lastDropRef = useRef<{ time: number; pathsKey: string }>({
    time: 0,
    pathsKey: "",
  });
  const unlistenRef = useRef<(() => void) | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep options in refs so the event handler always reads latest values
  // (projectPath intentionally excluded from useEffect deps — synced via ref)
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const projectPathRef = useRef(projectPath);
  projectPathRef.current = projectPath;

  useEffect(() => {
    if (!enabled) {
      setState(IDLE_STATE);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        if (cancelled) return;

        const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (!enabledRef.current) return;

          const container = containerRef.current;
          if (!container) return;

          // On macOS WKWebView, Tauri's PhysicalPosition already reports
          // logical (point) coordinates — no devicePixelRatio conversion needed.
          const toLogical = (pos: { x: number; y: number }) => ({
            x: pos.x,
            y: pos.y,
          });

          if (event.payload.type === "enter") {
            const { paths } = event.payload;
            const { x, y } = toLogical(event.payload.position);

            cachedPathsRef.current = paths;

            if (isWithinBounds(container, x, y)) {
              setState({
                isDragOver: true,
                targetDirPath: hitTestDropTarget(x, y),
                fileCount: paths.length,
                dropError: null,
              });
            }
          } else if (event.payload.type === "over") {
            const now = Date.now();
            if (now - lastOverTimeRef.current < OVER_THROTTLE_MS) return;
            lastOverTimeRef.current = now;

            const { x, y } = toLogical(event.payload.position);

            if (isWithinBounds(container, x, y)) {
              setState((prev) => ({
                isDragOver: true,
                targetDirPath: hitTestDropTarget(x, y),
                fileCount: prev.fileCount || cachedPathsRef.current.length,
                dropError: null,
              }));
            } else {
              setState((prev) => {
                if (!prev.isDragOver) return prev;
                return { ...IDLE_STATE, dropError: prev.dropError };
              });
            }
          } else if (event.payload.type === "drop") {
            const { paths, position } = event.payload;

            setState((prev) => ({ ...IDLE_STATE, dropError: prev.dropError }));

            // Dedup: ignore duplicate drop events within window
            const pathsKey = paths.join("|");
            const now = Date.now();
            if (
              now - lastDropRef.current.time < DROP_DEDUP_MS &&
              lastDropRef.current.pathsKey === pathsKey
            ) {
              return;
            }
            lastDropRef.current = { time: now, pathsKey };

            const { x, y } = toLogical(position);

            if (!isWithinBounds(container, x, y) || paths.length === 0) {
              return;
            }

            const targetDir = hitTestDropTarget(x, y) ?? "";

            // Default to autoRename so dropped files never silently overwrite existing content.
            const showDropError = (msg: string) => {
              setState((prev) => ({ ...prev, dropError: msg }));
              if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
              errorTimerRef.current = setTimeout(() => {
                setState((prev) => ({ ...prev, dropError: null }));
              }, DROP_ERROR_DISPLAY_MS);
            };

            useFileStore.getState().copyExternalEntriesToTree(
              projectPathRef.current,
              targetDir,
              paths,
              "autoRename",
            ).then((result) => {
              if (result === null) {
                // Store caught the error internally — read it for display
                const storeError = useFileStore.getState().error;
                if (storeError) showDropError(storeError);
              } else if (result.skipped.length > 0) {
                showDropError(`${result.skipped.length} file(s) skipped`);
              }
            });
          } else {
            // leave — reset everything
            cachedPathsRef.current = [];
            setState((prev) => ({ ...IDLE_STATE, dropError: prev.dropError }));
          }
        });

        if (cancelled) {
          unlisten();
          return;
        }
        unlistenRef.current = unlisten;
      } catch (e) {
        // Tauri API unavailable (e.g., running outside Tauri context)
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[useFileTreeDropZone] setup failed:", msg);
        setState((prev) => ({ ...prev, dropError: `Drag-drop unavailable: ${msg}` }));
      }
    })();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
    };
  }, [enabled, containerRef]);

  return state;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Check if a logical (CSS) coordinate is within a container's bounds. */
function isWithinBounds(
  container: HTMLElement,
  logicalX: number,
  logicalY: number,
): boolean {
  const rect = container.getBoundingClientRect();
  return (
    logicalX >= rect.left &&
    logicalX <= rect.right &&
    logicalY >= rect.top &&
    logicalY <= rect.bottom
  );
}

/**
 * Hit-test the DOM at a logical position to find the nearest directory
 * with a `data-drop-path` attribute. Returns null if no target found.
 */
function hitTestDropTarget(
  logicalX: number,
  logicalY: number,
): string | null {
  const elements = document.elementsFromPoint(logicalX, logicalY);
  for (const el of elements) {
    const dropPath = (el as HTMLElement).dataset?.dropPath;
    if (dropPath !== undefined) {
      return dropPath;
    }
  }
  return null;
}
