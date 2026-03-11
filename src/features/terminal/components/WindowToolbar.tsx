import { memo, useCallback } from "react";
import { Button } from "../../../components/ui/button";
import {
  closeTmuxWindow,
  nextTmuxWindow,
  previousTmuxWindow,
} from "../../../lib/tauri/commands";
import type { PaneAction } from "../types";

interface WindowToolbarProps {
  sessionName: string;
  disabled: boolean;
  onRequestAction: (action: PaneAction) => void;
  /** Project or connection name to display */
  title?: string;
  /** Callback to surface errors to the user (e.g. via terminalStore.setError) */
  onError?: (message: string) => void;
  /** Override: close window (remote mode). Must return a Promise for chaining. */
  onCloseWindow?: () => Promise<void>;
  /** Override: next window (remote mode). Must return a Promise for chaining. */
  onNextWindow?: () => Promise<void>;
  /** Override: prev window (remote mode). Must return a Promise for chaining. */
  onPrevWindow?: () => Promise<void>;
}

const TOOLBAR_BTN = "h-[26px] px-1.5 text-xs text-text-muted";

/** Run override or local tmux command, surfacing failures. */
function runWindowAction(
  overrideFn: (() => Promise<void>) | undefined,
  localFn: () => Promise<void>,
  label: string,
  onError?: (message: string) => void,
): void {
  const action = overrideFn ?? localFn;
  action().catch((e) => {
    const msg = `${label} failed: ${e instanceof Error ? e.message : String(e)}`;
    console.error(msg);
    onError?.(msg);
  });
}

export const WindowToolbar = memo(function WindowToolbar({
  sessionName,
  disabled,
  onRequestAction,
  title,
  onError,
  onCloseWindow,
  onNextWindow,
  onPrevWindow,
}: WindowToolbarProps) {
  const handleNew = useCallback(
    () => onRequestAction("new-window"),
    [onRequestAction],
  );

  const handleClose = useCallback(
    () => runWindowAction(onCloseWindow, () => closeTmuxWindow(sessionName), "Close window", onError),
    [onCloseWindow, sessionName, onError],
  );

  const handleNext = useCallback(
    () => runWindowAction(onNextWindow, () => nextTmuxWindow(sessionName), "Next window", onError),
    [onNextWindow, sessionName, onError],
  );

  const handlePrev = useCallback(
    () => runWindowAction(onPrevWindow, () => previousTmuxWindow(sessionName), "Previous window", onError),
    [onPrevWindow, sessionName, onError],
  );

  return (
    <div
      style={{ height: 32, flexShrink: 0 }}
      className="flex items-center gap-1 border-b border-white/[0.06] glass-toolbar px-2"
    >
      {/* Project / connection title — spacer when absent */}
      {title ? (
        <span className="text-xs font-medium text-text-secondary select-none truncate max-w-[200px] mr-auto">
          {title}
        </span>
      ) : (
        <div className="mr-auto" />
      )}

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
