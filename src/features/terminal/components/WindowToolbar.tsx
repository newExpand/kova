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
import { SshQuickConnect } from "../../ssh";

interface WindowToolbarProps {
  sessionName: string;
  disabled: boolean;
  isActive: boolean;
  projectId?: string | null;
  onRequestAction: (action: PaneAction) => void;
}

const TOOLBAR_BTN = "h-[26px] px-1.5 text-xs text-text-muted";

export const WindowToolbar = memo(function WindowToolbar({
  sessionName,
  disabled,
  isActive,
  projectId,
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

  // Polling every 3s — only when active (visible tab)
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(fetchWindows, 3000);
    return () => clearInterval(interval);
  }, [fetchWindows, isActive]);

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
      style={{ height: 32, flexShrink: 0 }}
      className="flex items-center gap-1 border-b border-white/[0.06] glass-toolbar px-2"
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
        className={TOOLBAR_BTN}
      >
        ← <span className="ml-0.5 opacity-60">⌘⇧[</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleNext}
        title="Next window (⌘⇧])"
        className={TOOLBAR_BTN}
      >
        → <span className="ml-0.5 opacity-60">⌘⇧]</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleNew}
        title="New window (⌘T)"
        className={TOOLBAR_BTN}
      >
        + <span className="ml-0.5 opacity-60">⌘T</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleClose}
        title="Close window (⌘⇧W)"
        className={TOOLBAR_BTN}
      >
        ✕ <span className="ml-0.5 opacity-60">⌘⇧W</span>
      </Button>

      {/* Separator between tmux controls and SSH */}
      <div className="h-3.5 w-px bg-white/[0.08] mx-1" />

      {/* SSH Quick Connect */}
      <SshQuickConnect
        sessionName={sessionName}
        projectId={projectId ?? null}
        disabled={disabled}
      />
    </div>
  );
});
