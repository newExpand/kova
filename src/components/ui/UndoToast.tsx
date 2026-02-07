import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';

interface UndoToastProps {
  message: string;
  onUndo: () => void;
  onClose: () => void;
  duration?: number;
}

/**
 * Undo 토스트 컴포넌트
 *
 * - 슬라이드 업 + 페이드 애니메이션 (300ms in, 200ms out)
 * - 5초 자동 닫힘 (기본값)
 * - Bottom center fixed position
 * - "[메시지] — [되돌리기] [닫기]"
 */
export function UndoToast({ message, onUndo, onClose, duration = 5000 }: UndoToastProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 마운트 시 애니메이션 트리거
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // 자동 닫힘 타이머
    const timer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  const handleClose = () => {
    setIsVisible(false);
    // 애니메이션 완료 후 실제 제거
    setTimeout(() => {
      onClose();
    }, 200);
  };

  const handleUndo = () => {
    onUndo();
    handleClose();
  };

  return (
    <div
      className={`fixed bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-surface-3 px-4 py-3 shadow-lg transition-all duration-300 ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
      role="alert"
      aria-live="polite"
    >
      <span className="text-sm text-foreground">{message}</span>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleUndo}
          className="h-auto py-1 text-primary hover:text-primary-hover"
        >
          되돌리기
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          className="h-6 w-6"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
