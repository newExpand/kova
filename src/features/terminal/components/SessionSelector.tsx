import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { useTmuxSessions } from "../../tmux/hooks/useTmuxSessions";
import type { SessionMode, TerminalConfig } from "../types";

interface SessionSelectorProps {
  projectName: string;
  onConnect: (config: TerminalConfig) => void;
  disabled?: boolean;
}

function SessionSelector({ projectName, onConnect, disabled }: SessionSelectorProps) {
  const { sessions, isAvailable } = useTmuxSessions();
  const [mode, setMode] = useState<SessionMode>("new");
  const [sessionName, setSessionName] = useState(
    () => `${projectName.toLowerCase().replace(/\s+/g, "-")}`,
  );
  const [selectedExisting, setSelectedExisting] = useState("");

  const handleConnect = () => {
    const name = mode === "new" ? sessionName.trim() : selectedExisting;
    if (!name) return;
    onConnect({ projectId: "", sessionName: name, mode, cols: 80, rows: 24 });
  };

  if (isAvailable === false) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-secondary p-6">
        <p className="text-sm text-text-muted">
          tmux is not installed. Please install tmux to use the terminal.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <div className="flex flex-col gap-3">
        {/* Mode selector */}
        <div className="flex gap-2">
          <Button
            variant={mode === "new" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("new")}
            disabled={disabled}
          >
            New Session
          </Button>
          <Button
            variant={mode === "attach" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("attach")}
            disabled={disabled || sessions.length === 0}
          >
            Attach
          </Button>
        </div>

        {/* Session input */}
        <div className="flex items-center gap-2">
          {mode === "new" ? (
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Session name"
              disabled={disabled}
              className="flex-1 rounded-md border border-border bg-bg-primary px-3 py-1.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <select
              value={selectedExisting}
              onChange={(e) => setSelectedExisting(e.target.value)}
              disabled={disabled}
              className="flex-1 rounded-md border border-border bg-bg-primary px-3 py-1.5 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select a session...</option>
              {sessions.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.windows} windows{s.attached ? ", attached" : ""})
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={
              disabled ||
              (mode === "new" ? !sessionName.trim() : !selectedExisting)
            }
          >
            Connect
          </Button>
        </div>
      </div>
    </div>
  );
}

export { SessionSelector };
