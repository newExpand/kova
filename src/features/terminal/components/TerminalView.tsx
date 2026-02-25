import { useEffect, useCallback, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { useTerminal } from "../hooks/useTerminal";
import { useTerminalStore } from "../stores/terminalStore";
import type { TerminalConfig, PaneAction } from "../types";

interface TerminalViewProps {
  config: TerminalConfig;
  isActive: boolean;
  glassClassName?: string;
  onRequestPaneAction?: (action: PaneAction) => void;
  onPtySpawn?: (pid: number) => void;
}

function TerminalView({ config, isActive, glassClassName, onRequestPaneAction, onPtySpawn }: TerminalViewProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const { containerRef, connect, disconnect, refit } = useTerminal({
    onDragState: setIsDragOver,
    onRequestPaneAction,
    onPtySpawn,
    isActive,
  });
  const status = useTerminalStore((s) => s.getTerminal(config.projectId).status);
  const error = useTerminalStore((s) => s.getTerminal(config.projectId).error);

  useEffect(() => {
    connect(config);
    return () => {
      disconnect();
    };
    // Only reconnect when config identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.sessionName]);

  // Re-fit when becoming visible (display:none → flex transition)
  useEffect(() => {
    if (isActive && status === "connected") {
      // Double rAF: first frame applies display change, second ensures layout
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          refit();
        });
      });
    }
  }, [isActive, status, refit]);

  // Re-focus xterm.js when the user clicks anywhere on the terminal area.
  // This handles cases where focus was lost (e.g., clicking the overlay area
  // or tabbing away and back).
  const handleContainerClick = useCallback(() => {
    const xterm = containerRef.current?.querySelector(".xterm") as HTMLElement | null;
    if (xterm) {
      // xterm.js exposes focus via the .xterm element's internal textarea
      const textarea = xterm.querySelector("textarea");
      textarea?.focus();
    }
  }, [containerRef]);

  return (
    <div
      className={glassClassName}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
      onMouseDown={handleContainerClick}
    >
      {/* Status overlay */}
      {status === "connecting" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <p className="text-sm text-text-muted">
            {config.isSshMode ? "Connecting to SSH server..." : "Connecting to tmux session..."}
          </p>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="text-center">
            <p className="text-sm text-danger">Connection failed</p>
            {error && (
              <p className="mt-1 max-w-md text-xs text-text-muted">{error}</p>
            )}
          </div>
        </div>
      )}

      {/* Drag-drop overlay */}
      {isDragOver && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-text-muted/40"
          style={{
            backgroundColor: "var(--terminal-drag-bg, rgba(26, 27, 38, 0.7))",
            pointerEvents: "none",
          }}
        >
          <p className="text-sm text-text-muted">Drop files to paste path</p>
        </div>
      )}

      {/* xterm.js mounts here — needs real pixel dimensions */}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />
    </div>
  );
}

export { TerminalView };
