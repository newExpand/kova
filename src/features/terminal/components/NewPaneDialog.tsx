import { useState, useCallback } from "react";
import { GitBranch } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { AGENT_TYPES, type AgentType } from "../../../lib/tauri/commands";
import type { PaneAction } from "../types";

const ACTION_LABELS: Record<PaneAction, string> = {
  "split-vertical": "Split Vertical",
  "split-horizontal": "Split Horizontal",
  "new-window": "New Window",
};

const AGENT_TYPE_KEYS = Object.keys(AGENT_TYPES) as AgentType[];

const TASK_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_TASK_NAME_LENGTH = 50;

interface NewPaneDialogProps {
  action: PaneAction | null;
  onConfirm: (startClaude: boolean, selectedAgentType?: AgentType, worktreeTaskName?: string) => void;
  onCancel: () => void;
  defaultAgentType: AgentType;
  projectPath?: string;
  isSshMode?: boolean;
}

export function NewPaneDialog({
  action,
  onConfirm,
  onCancel,
  defaultAgentType,
  projectPath,
  isSshMode,
}: NewPaneDialogProps) {
  const [worktreeMode, setWorktreeMode] = useState(false);
  const [taskName, setTaskName] = useState("");

  const isValidTaskName =
    taskName.length > 0 &&
    taskName.length <= MAX_TASK_NAME_LENGTH &&
    TASK_NAME_REGEX.test(taskName);

  const showWorktreeSection =
    action === "new-window" && !!projectPath && !isSshMode && defaultAgentType === "claudeCode";

  const handleEmptyShell = useCallback(() => onConfirm(false), [onConfirm]);
  const handleSelectAgent = useCallback(
    (type: AgentType) => onConfirm(true, type),
    [onConfirm],
  );

  const handleWorktreeSubmit = useCallback(() => {
    if (!isValidTaskName) return;
    onConfirm(true, "claudeCode", taskName);
  }, [isValidTaskName, onConfirm, taskName]);

  const resetWorktreeState = useCallback(() => {
    setWorktreeMode(false);
    setTaskName("");
  }, []);

  const handleCancel = useCallback(() => {
    resetWorktreeState();
    onCancel();
  }, [resetWorktreeState, onCancel]);

  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => !open && handleCancel()}
    >
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>
            {action ? ACTION_LABELS[action] : ""}
          </DialogTitle>
          <DialogDescription>
            Choose how to start the new {action ? ACTION_LABELS[action].toLowerCase() : "session"}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {!worktreeMode && (
            <>
              <Button
                variant="secondary"
                className="w-full justify-start"
                onClick={handleEmptyShell}
              >
                Empty Shell
              </Button>
              {AGENT_TYPE_KEYS.map((type) => {
                const isDefault = type === defaultAgentType;
                return (
                  <Button
                    key={type}
                    variant={isDefault ? "default" : "outline"}
                    className="w-full justify-start"
                    autoFocus={isDefault}
                    onClick={() => handleSelectAgent(type)}
                  >
                    {AGENT_TYPES[type].label}
                    {isDefault && (
                      <span className="ml-auto text-[10px] opacity-60">default</span>
                    )}
                  </Button>
                );
              })}
            </>
          )}

          {showWorktreeSection && !worktreeMode && (
            <div className="border-t border-white/[0.06] pt-2 mt-1">
              <p className="text-[11px] text-text-muted mb-1.5">Git Worktree</p>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setWorktreeMode(true)}
              >
                <GitBranch className="mr-2 h-3.5 w-3.5" />
                Claude Code + Worktree
              </Button>
            </div>
          )}

          {showWorktreeSection && worktreeMode && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <GitBranch className="h-3.5 w-3.5" />
                <span>Claude Code + Worktree</span>
              </div>
              <div>
                <input
                  autoFocus
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isValidTaskName) handleWorktreeSubmit();
                    if (e.key === "Escape") resetWorktreeState();
                  }}
                  placeholder="task-name"
                  maxLength={MAX_TASK_NAME_LENGTH}
                  className="w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {taskName.length > 0 && !TASK_NAME_REGEX.test(taskName) && (
                  <p className="mt-1 text-xs text-danger">
                    Letters, numbers, hyphens, underscores only
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetWorktreeState}
                >
                  Back
                </Button>
                <Button
                  size="sm"
                  disabled={!isValidTaskName}
                  onClick={handleWorktreeSubmit}
                >
                  Start
                </Button>
              </div>
            </div>
          )}
        </div>
        {!worktreeMode && (
          <div className="flex justify-end pt-1">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
