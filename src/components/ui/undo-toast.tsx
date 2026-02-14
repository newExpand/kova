import { useEffect, useRef, useState, useCallback } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

interface UndoToastProps {
  message: string;
  duration?: number;
  onUndo: () => void;
  onDismiss: () => void;
}

function UndoToast({
  message,
  duration = 5000,
  onUndo,
  onDismiss,
}: UndoToastProps) {
  const [progress, setProgress] = useState(100);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  const startTimeRef = useRef(Date.now());

  const handleDismiss = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    onDismiss();
  }, [onDismiss]);

  const handleUndo = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    onUndo();
  }, [onUndo]);

  useEffect(() => {
    startTimeRef.current = Date.now();

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);

      if (remaining <= 0) {
        handleDismiss();
      }
    }, 50);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [duration, handleDismiss]);

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-50 -translate-x-1/2",
        "flex items-center gap-3 rounded-xl border border-white/[0.15] glass-elevated glass-specular px-4 py-3",
        "animate-in slide-in-from-bottom-5 fade-in duration-300",
      )}
    >
      <span className="text-sm text-text">{message}</span>

      <button
        onClick={handleUndo}
        className="shrink-0 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
      >
        Undo
      </button>

      <button
        onClick={handleDismiss}
        className="shrink-0 rounded-sm p-0.5 text-text-muted hover:text-text transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Timer progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden rounded-b-lg">
        <div
          className="h-full bg-primary transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export { UndoToast };
export type { UndoToastProps };
