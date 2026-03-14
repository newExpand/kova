import { useState, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { startWorktreeTask, AGENT_TYPES, DEFAULT_AGENT_TYPE, type AgentType } from "../../../lib/tauri/commands";
import { useSystemCheck } from "../../environment";
import type { EnvironmentCheck } from "../../environment";
import { useSettingsStore } from "../../settings/stores/settingsStore";

interface NewAgentTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionName: string | null;
  projectPath: string;
  agentType?: AgentType;
  onCreated?: () => void;
}

const TASK_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_TASK_NAME_LENGTH = 50;

interface AgentCommandEntry { command: string; defaultCommand: string }

function getAgentStatus(
  env: EnvironmentCheck | null,
  agentType: AgentType,
  agentCommands: Record<AgentType, AgentCommandEntry>,
): { installed: boolean; cmd: string } | null {
  if (!env) return null;
  // Custom command configured → treat as available regardless of binary detection
  const entry = agentCommands[agentType];
  if (entry.command !== entry.defaultCommand) return { installed: true, cmd: entry.command };
  switch (agentType) {
    case "claudeCode":
      return { installed: env.claudeCodeInstalled, cmd: "npm install -g @anthropic-ai/claude-code" };
    case "codexCli":
      return { installed: env.codexCliInstalled, cmd: "npm install -g @openai/codex" };
    case "geminiCli":
      return { installed: env.geminiCliInstalled, cmd: "npm install -g @google/gemini-cli" };
  }
}

export function NewAgentTaskDialog({
  open,
  onOpenChange,
  sessionName,
  projectPath,
  agentType = DEFAULT_AGENT_TYPE,
  onCreated,
}: NewAgentTaskDialogProps) {
  const agentLabel = AGENT_TYPES[agentType].label;
  const { env } = useSystemCheck();
  const agentCommands = useSettingsStore((s) => s.agentCommands);
  const agentStatus = getAgentStatus(env, agentType, agentCommands);
  const [taskName, setTaskName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setTaskName("");
      setError(null);
    }
  }, [open]);

  const isValid =
    taskName.length > 0 &&
    taskName.length <= MAX_TASK_NAME_LENGTH &&
    TASK_NAME_REGEX.test(taskName);

  const agentBlocked = agentStatus !== null && !agentStatus.installed;

  const handleSubmit = useCallback(async () => {
    if (!isValid || !sessionName || agentBlocked) return;

    setIsLoading(true);
    setError(null);

    try {
      await startWorktreeTask(sessionName, taskName, projectPath, agentType);
      setTaskName("");
      onCreated?.();
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [isValid, sessionName, taskName, projectPath, agentType, agentBlocked, onOpenChange, onCreated]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && isValid && !isLoading && !agentBlocked) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [isValid, isLoading, agentBlocked, handleSubmit],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Agent Worktree</DialogTitle>
          <DialogDescription>
            Create a new tmux window with {agentLabel} worktree.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label
              htmlFor="task-name"
              className="mb-1 block text-sm font-medium text-text-secondary"
            >
              Task name
            </label>
            <input
              id="task-name"
              type="text"
              autoFocus
              value={taskName}
              onChange={(e) => {
                setTaskName(e.target.value);
                setError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="fix-auth"
              maxLength={MAX_TASK_NAME_LENGTH}
              className="w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {taskName.length > 0 && !TASK_NAME_REGEX.test(taskName) && (
              <p className="mt-1 text-xs text-danger">
                Letters, numbers, hyphens, underscores only
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          {agentStatus && !agentStatus.installed && (
            <div className="rounded-md bg-warning/10 px-3 py-2 text-sm">
              <p className="font-medium text-warning">{agentLabel} is not installed</p>
              <p className="mt-1 text-xs text-text-muted">
                Install with:{" "}
                <code className="rounded bg-bg-tertiary px-1 py-0.5 font-mono">
                  {agentStatus.cmd}
                </code>
              </p>
            </div>
          )}

          {!sessionName && (
            <p className="text-sm text-warning">
              No active tmux session. Open the terminal first.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!isValid || isLoading || !sessionName || agentBlocked}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Creating...
              </>
            ) : (
              "Start"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
