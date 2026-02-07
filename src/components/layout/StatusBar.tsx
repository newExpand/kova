import { useNetworkStore } from '@/stores/networkStore';

export function StatusBar() {
  const isOnline = useNetworkStore((s) => s.isOnline);

  return (
    <footer className="flex h-6 items-center justify-between border-t border-border bg-surface-1 px-3">
      <span className="text-[11px] text-text-muted">flow-orche v0.1.0</span>
      <div className="flex items-center gap-2">
        {!isOnline && (
          <div className="flex items-center gap-1" role="status" aria-live="polite">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-warning" />
            <span className="text-[11px] text-status-warning">오프라인</span>
          </div>
        )}
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-status-success' : 'bg-status-error'}`}
        />
        <span className="text-[11px] text-text-muted">
          {isOnline ? 'Ready' : 'Offline'}
        </span>
      </div>
    </footer>
  );
}
