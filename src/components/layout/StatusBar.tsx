import { cn } from "../../lib/utils";

interface StatusBarProps {
  connected: boolean;
  tmuxAvailable: boolean | null;
}

function StatusBar({ connected, tmuxAvailable }: StatusBarProps) {
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.08] glass-toolbar px-4 text-[10px] text-text-muted">
      <div className="flex items-center gap-3">
        {/* Event server status */}
        <span className="flex items-center gap-1">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              connected ? "bg-success" : "bg-danger",
            )}
          />
          Event Server
        </span>

        {/* tmux status */}
        <span className="flex items-center gap-1">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              tmuxAvailable === true
                ? "bg-success"
                : tmuxAvailable === false
                  ? "bg-danger"
                  : "bg-warning",
            )}
          />
          tmux
        </span>
      </div>

      <span>Clew v0.1.0</span>
    </footer>
  );
}

export { StatusBar };
