import { useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import type { PaneAction } from "../types";

const ACTION_LABELS: Record<PaneAction, string> = {
  "split-vertical": "Split Vertical",
  "split-horizontal": "Split Horizontal",
  "new-window": "New Window",
};

interface NewPaneDialogProps {
  action: PaneAction | null;
  onConfirm: (startClaude: boolean) => void;
  onCancel: () => void;
}

export function NewPaneDialog({
  action,
  onConfirm,
  onCancel,
}: NewPaneDialogProps) {
  const handleStartClaude = useCallback(() => onConfirm(true), [onConfirm]);
  const handleEmptyShell = useCallback(() => onConfirm(false), [onConfirm]);

  return (
    <Dialog open={action !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {action ? ACTION_LABELS[action] : ""}
          </DialogTitle>
          <DialogDescription>
            How would you like to start the new {action ? ACTION_LABELS[action].toLowerCase() : "session"}?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={handleEmptyShell}>
            Empty Shell
          </Button>
          <Button autoFocus onClick={handleStartClaude}>
            Start with Claude
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
