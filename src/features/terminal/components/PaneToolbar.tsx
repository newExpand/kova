import { memo, useCallback } from "react";
import { Palette } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { closeTmuxPane } from "../../../lib/tauri/commands";
import type { PaneAction } from "../types";

interface PaneToolbarProps {
  sessionName: string;
  disabled: boolean;
  onRequestAction: (action: PaneAction) => void;
  onToggleThemePicker?: () => void;
  /** Override: close pane (remote mode) */
  onClosePane?: () => void;
}

const TOOLBAR_BTN = "h-[26px] px-2 text-xs text-text-muted";

export const PaneToolbar = memo(function PaneToolbar({
  sessionName,
  disabled,
  onRequestAction,
  onToggleThemePicker,
  onClosePane,
}: PaneToolbarProps) {
  const handleSplitVertical = useCallback(
    () => onRequestAction("split-vertical"),
    [onRequestAction],
  );

  const handleSplitHorizontal = useCallback(
    () => onRequestAction("split-horizontal"),
    [onRequestAction],
  );

  const handleClosePane = useCallback(() => {
    if (onClosePane) {
      onClosePane();
    } else {
      closeTmuxPane(sessionName).catch((e) =>
        console.error("Close pane failed:", e),
      );
    }
  }, [sessionName, onClosePane]);

  return (
    <div
      style={{ height: 32, flexShrink: 0 }}
      className="flex items-center gap-1 border-b border-white/[0.06] glass-toolbar px-2"
    >
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleSplitVertical}
        title="Split pane left/right (⌘D)"
        className={TOOLBAR_BTN}
      >
        ⏐ <span className="ml-1 opacity-60">⌘D</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleSplitHorizontal}
        title="Split pane top/bottom (⌘⇧D)"
        className={TOOLBAR_BTN}
      >
        ⎯ <span className="ml-1 opacity-60">⌘⇧D</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleClosePane}
        title="Close active pane (⌘W)"
        className={TOOLBAR_BTN}
      >
        ✕ <span className="ml-1 opacity-60">⌘W</span>
      </Button>
      {onToggleThemePicker && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleThemePicker}
          title="Change terminal theme"
          className={`ml-auto ${TOOLBAR_BTN}`}
        >
          <Palette className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
});
