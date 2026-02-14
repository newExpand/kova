import { useEffect, useCallback, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { useTerminal } from "../hooks/useTerminal";
import { useTerminalStore } from "../stores/terminalStore";
import type { TerminalConfig } from "../types";

interface TerminalViewProps {
  config: TerminalConfig;
}

function TerminalView({ config }: TerminalViewProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const { containerRef, connect, disconnect } = useTerminal({
    onDragState: setIsDragOver,
  });
  const status = useTerminalStore((s) => s.status);
  const error = useTerminalStore((s) => s.error);

  useEffect(() => {
    connect(config);
    return () => {
      disconnect();
    };
    // Only reconnect when config identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.sessionName, config.mode]);

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
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/80">
          <p className="text-sm text-text-muted">Connecting to tmux session...</p>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/80">
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
            backgroundColor: "rgba(26, 27, 38, 0.7)",
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
