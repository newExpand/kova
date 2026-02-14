import { memo, useCallback, useState, useEffect, useRef } from "react";
import { Button } from "../../../components/ui/button";
import {
  listTmuxWindows,
  closeTmuxWindow,
  nextTmuxWindow,
  previousTmuxWindow,
} from "../../../lib/tauri/commands";
import type { TmuxWindow } from "../../../lib/tauri/commands";
import type { PaneAction } from "../types";

interface WindowToolbarProps {
  sessionName: string;
  disabled: boolean;
  onRequestAction: (action: PaneAction) => void;
}

export const WindowToolbar = memo(function WindowToolbar({
  sessionName,
  disabled,
  onRequestAction,
}: WindowToolbarProps) {
  const [windows, setWindows] = useState<TmuxWindow[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchWindows = useCallback(() => {
    listTmuxWindows(sessionName)
      .then((data) => {
        if (mountedRef.current) setWindows(data);
      })
      .catch((e) => console.error("List windows failed:", e));
  }, [sessionName]);

  // Initial fetch
  useEffect(() => {
    fetchWindows();
  }, [fetchWindows]);

  // Polling every 3s
  useEffect(() => {
    const interval = setInterval(fetchWindows, 3000);
    return () => clearInterval(interval);
  }, [fetchWindows]);

  const handleNew = useCallback(
    () => onRequestAction("new-window"),
    [onRequestAction],
  );

  const handleClose = useCallback(() => {
    closeTmuxWindow(sessionName)
      .then(fetchWindows)
      .catch((e) => console.error("Close window failed:", e));
  }, [sessionName, fetchWindows]);

  const handleNext = useCallback(() => {
    nextTmuxWindow(sessionName)
      .then(fetchWindows)
      .catch((e) => console.error("Next window failed:", e));
  }, [sessionName, fetchWindows]);

  const handlePrev = useCallback(() => {
    previousTmuxWindow(sessionName)
      .then(fetchWindows)
      .catch((e) => console.error("Previous window failed:", e));
  }, [sessionName, fetchWindows]);

  return (
    <div
      style={{ height: 28, flexShrink: 0 }}
      className="flex items-center gap-1 border-b border-border bg-bg-secondary px-2"
    >
      {/* Window tabs */}
      <div className="flex items-center gap-0.5 overflow-x-auto mr-auto">
        {windows.map((w) => (
          <span
            key={w.windowIndex}
            className={`inline-flex items-center rounded px-1.5 text-xs ${
              w.windowActive
                ? "bg-accent text-white"
                : "text-text-muted hover:bg-bg-tertiary"
            }`}
          >
            {w.windowIndex}: {w.windowName}
          </span>
        ))}
      </div>

      {/* Navigation & action buttons */}
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handlePrev}
        title="Previous window (⌘⇧[)"
        className="h-6 px-1.5 text-xs text-text-muted"
      >
        ← <span className="ml-0.5 opacity-60">⌘⇧[</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleNext}
        title="Next window (⌘⇧])"
        className="h-6 px-1.5 text-xs text-text-muted"
      >
        → <span className="ml-0.5 opacity-60">⌘⇧]</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleNew}
        title="New window (⌘T)"
        className="h-6 px-1.5 text-xs text-text-muted"
      >
        + <span className="ml-0.5 opacity-60">⌘T</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleClose}
        title="Close window (⌘⇧W)"
        className="h-6 px-1.5 text-xs text-text-muted"
      >
        ✕ <span className="ml-0.5 opacity-60">⌘⇧W</span>
      </Button>
    </div>
  );
});
