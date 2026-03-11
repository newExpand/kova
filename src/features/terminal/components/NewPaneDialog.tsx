import { useCallback } from "react";
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

interface NewPaneDialogProps {
  action: PaneAction | null;
  onConfirm: (startClaude: boolean, selectedAgentType?: AgentType) => void;
  onCancel: () => void;
  defaultAgentType: AgentType;
}

export function NewPaneDialog({
  action,
  onConfirm,
  onCancel,
  defaultAgentType,
}: NewPaneDialogProps) {
  const handleEmptyShell = useCallback(() => onConfirm(false), [onConfirm]);
  const handleSelectAgent = useCallback(
    (type: AgentType) => onConfirm(true, type),
    [onConfirm],
  );

  return (
    <Dialog open={action !== null} onOpenChange={(open) => !open && onCancel()}>
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
        </div>
        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
