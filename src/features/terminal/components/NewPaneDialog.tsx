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
  "split-vertical": "좌우 분할",
  "split-horizontal": "상하 분할",
  "new-window": "새 윈도우",
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
            새 {action ? ACTION_LABELS[action] : "세션"}을 어떻게 시작할까요?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="ghost" onClick={onCancel}>
            취소
          </Button>
          <Button variant="secondary" onClick={handleEmptyShell}>
            빈 셸
          </Button>
          <Button autoFocus onClick={handleStartClaude}>
            Claude로 시작
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
