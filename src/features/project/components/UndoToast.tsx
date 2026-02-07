import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UndoToastProps {
  projectName: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
}

/**
 * 삭제 Undo 토스트
 *
 * - 5초 카운트다운 프로그레스 바
 * - Undo 버튼 클릭 시 삭제 취소
 * - 자동 dismiss (타이머는 store에서 관리)
 */
export function UndoToast({
  projectName,
  onUndo,
  onDismiss,
  durationMs = 5000,
}: UndoToastProps) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const interval = 50; // 50ms 간격 업데이트
    const decrement = (interval / durationMs) * 100;
    const timer = setInterval(() => {
      setProgress((prev) => {
        const next = prev - decrement;
        if (next <= 0) {
          clearInterval(timer);
          return 0;
        }
        return next;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [durationMs]);

  return (
    <div
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 shadow-lg"
      role="alert"
      aria-live="assertive"
    >
      <span className="text-sm text-foreground">
        <strong>{projectName}</strong> 프로젝트가 삭제되었습니다
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onUndo}
        className="shrink-0"
      >
        되돌리기
      </Button>
      <button
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 text-text-muted hover:text-foreground"
        aria-label="닫기"
      >
        <X className="h-4 w-4" />
      </button>
      {/* 프로그레스 바 */}
      <div className="absolute bottom-0 left-0 h-0.5 w-full overflow-hidden rounded-b-lg">
        <div
          className="h-full bg-primary transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
