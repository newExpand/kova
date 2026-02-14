import { memo, useCallback } from "react";
import { Button } from "../../../components/ui/button";
import {
  splitTmuxPaneVertical,
  splitTmuxPaneHorizontal,
  closeTmuxPane,
} from "../../../lib/tauri/commands";

interface PaneToolbarProps {
  sessionName: string;
  disabled: boolean;
}

export const PaneToolbar = memo(function PaneToolbar({
  sessionName,
  disabled,
}: PaneToolbarProps) {
  const handleSplitVertical = useCallback(() => {
    splitTmuxPaneVertical(sessionName).catch((e) =>
      console.error("Split vertical failed:", e),
    );
  }, [sessionName]);

  const handleSplitHorizontal = useCallback(() => {
    splitTmuxPaneHorizontal(sessionName).catch((e) =>
      console.error("Split horizontal failed:", e),
    );
  }, [sessionName]);

  const handleClosePane = useCallback(() => {
    closeTmuxPane(sessionName).catch((e) =>
      console.error("Close pane failed:", e),
    );
  }, [sessionName]);

  return (
    <div
      style={{ height: 28, flexShrink: 0 }}
      className="flex items-center gap-1 border-b border-border bg-bg-secondary px-2"
    >
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleSplitVertical}
        title="Split pane left/right (⌘D)"
        className="h-6 px-2 text-xs text-text-muted"
      >
        ⏐ <span className="ml-1 opacity-60">⌘D</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleSplitHorizontal}
        title="Split pane top/bottom (⌘⇧D)"
        className="h-6 px-2 text-xs text-text-muted"
      >
        ⎯ <span className="ml-1 opacity-60">⌘⇧D</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={handleClosePane}
        title="Close active pane (⌘W)"
        className="h-6 px-2 text-xs text-text-muted"
      >
        ✕ <span className="ml-1 opacity-60">⌘W</span>
      </Button>
    </div>
  );
});
