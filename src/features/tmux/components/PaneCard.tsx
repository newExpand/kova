import type { TmuxPane } from "../types";
import { cn } from "../../../lib/utils";

interface PaneCardProps {
  pane: TmuxPane;
}

function PaneCard({ pane }: PaneCardProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-border-subtle px-3 py-2 transition-colors",
        pane.paneActive ? "border-primary bg-surface" : "bg-bg-secondary",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary">
          {pane.windowIndex}:{pane.paneIndex}
        </span>
        {pane.paneActive && (
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
        )}
      </div>
      <p className="mt-1 truncate text-sm text-text">{pane.paneTitle}</p>
      <p className="mt-0.5 truncate text-xs text-text-muted font-mono">
        {pane.paneCurrentCommand}
      </p>
    </div>
  );
}

export { PaneCard };
