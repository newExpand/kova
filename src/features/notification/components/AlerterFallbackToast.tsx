import { AlertTriangle, X } from "lucide-react";
import { useNotificationStore } from "../stores/notificationStore";

export function AlerterFallbackToast() {
  const shown = useNotificationStore((s) => s.alerterFallbackShown);
  const dismiss = useNotificationStore((s) => s.dismissAlerterFallbackWarning);

  if (!shown) return null;

  return (
    <div className="fixed bottom-8 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="glass-elevated rounded-lg border border-warning/20 p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">alerter not found</p>
            <p className="mt-1 text-xs text-text-muted">
              For persistent notifications, install alerter:
            </p>
            <code className="mt-1 block rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-xs text-text-secondary">
              brew install alerter
            </code>
          </div>
          <button onClick={dismiss} className="text-text-muted hover:text-text shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
