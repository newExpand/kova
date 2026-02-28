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
import { Globe } from "lucide-react";

interface WindowToolbarProps {
  sessionName: string;
  disabled: boolean;
  isActive: boolean;
  onRequestAction: (action: PaneAction) => void;
  /** Override: close window (remote mode). Must return a Promise for chaining. */
  onCloseWindow?: () => Promise<void>;
  /** Override: next window (remote mode). Must return a Promise for chaining. */
  onNextWindow?: () => Promise<void>;
  /** Override: prev window (remote mode). Must return a Promise for chaining. */
  onPrevWindow?: () => Promise<void>;
  /** Override: fetch window list (remote mode) */
  onFetchWindows?: () => Promise<TmuxWindow[]>;
}

const TOOLBAR_BTN = "h-[26px] px-1.5 text-xs text-text-muted";

export const WindowToolbar = memo(function WindowToolbar({
  sessionName,
  disabled,
  isActive,
  onRequestAction,
  onCloseWindow,
  onNextWindow,
  onPrevWindow,
  onFetchWindows,
}: WindowToolbarProps) {
  const [windows, setWindows] = useState<TmuxWindow[]>([]);
  const mountedRef = useRef(true);
  const consecutiveFailures = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchWindows = useCallback(() => {
    const fetcher = onFetchWindows
      ? onFetchWindows()
      : listTmuxWindows(sessionName);
    fetcher
      .then((data) => {
        if (mountedRef.current) {
          setWindows(data);
          consecutiveFailures.current = 0;
        }
      })
      .catch((e) => {
        consecutiveFailures.current += 1;
        if (consecutiveFailures.current <= 3) {
          console.error("List windows failed:", e);
        }
      });
  }, [sessionName, onFetchWindows]);

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

  // Shared handler: use remote override (Promise chained) or local tmux command.
  const handleWindowAction = useCallback(
    (
      overrideFn: (() => Promise<void>) | undefined,
      localFn: () => Promise<void>,
      label: string,
    ) => {
      const action = overrideFn ?? localFn;
      action()
        .then(fetchWindows)
        .catch((e) => console.error(`${label} failed:`, e));
    },
    [fetchWindows],
  );

  const handleClose = useCallback(
    () => handleWindowAction(onCloseWindow, () => closeTmuxWindow(sessionName), "Close window"),
    [handleWindowAction, onCloseWindow, sessionName],
  );

  const handleNext = useCallback(
    () => handleWindowAction(onNextWindow, () => nextTmuxWindow(sessionName), "Next window"),
    [handleWindowAction, onNextWindow, sessionName],
  );

  const handlePrev = useCallback(
    () => handleWindowAction(onPrevWindow, () => previousTmuxWindow(sessionName), "Previous window"),
    [handleWindowAction, onPrevWindow, sessionName],
  );

  return (
    <div
      style={{ height: 32, flexShrink: 0 }}
      className="flex items-center gap-1 border-b border-white/[0.06] glass-toolbar px-2"
    >
      {/* Window tabs */}
      <div className="flex items-center gap-0.5 overflow-x-auto mr-auto">
        {windows.map((w) => {
          const isSsh = w.windowName.startsWith("ssh-");
          return (
            <span
              key={w.windowIndex}
              className={`inline-flex items-center gap-0.5 rounded px-1.5 text-xs ${
                w.windowActive
                  ? "bg-accent text-white"
                  : "text-text-muted hover:bg-bg-tertiary"
              }`}
            >
              {isSsh && <Globe className="h-2.5 w-2.5" />}
              {w.windowIndex}: {isSsh ? w.windowName.slice(4) : w.windowName}
            </span>
          );
        })}
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
    </div>
  );
});
