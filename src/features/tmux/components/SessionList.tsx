import { useTmuxStore } from "../stores/tmuxStore";
import type { TmuxSession } from "../types";
import { cn } from "../../../lib/utils";

interface SessionItemProps {
  session: TmuxSession;
  isSelected: boolean;
  onSelect: (name: string) => void;
}

function SessionItem({ session, isSelected, onSelect }: SessionItemProps) {
  return (
    <button
      onClick={() => onSelect(session.name)}
      className={cn(
        "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
        isSelected ? "bg-surface text-text" : "text-text-secondary hover:bg-surface-hover",
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            session.attached ? "bg-success" : "bg-text-muted",
          )}
        />
        <span className="truncate font-medium">{session.name}</span>
      </div>
      <span className="shrink-0 text-xs text-text-muted">
        {session.windows}w
      </span>
    </button>
  );
}

function SessionList() {
  const sessions = useTmuxStore((s) => s.sessions);
  const selectedSession = useTmuxStore((s) => s.selectedSession);
  const selectSession = useTmuxStore((s) => s.selectSession);
  const isLoading = useTmuxStore((s) => s.isLoading);
  const isAvailable = useTmuxStore((s) => s.isAvailable);

  if (isAvailable === false) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-sm text-text-muted">tmux not available</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-sm text-text-muted">Loading sessions...</span>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-sm text-text-muted">No active sessions</span>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 p-2">
      {sessions.map((session) => (
        <SessionItem
          key={session.name}
          session={session}
          isSelected={selectedSession === session.name}
          onSelect={selectSession}
        />
      ))}
    </div>
  );
}

export { SessionList };
