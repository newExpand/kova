import { useNotificationStore } from "../stores/notificationStore";
import { NotificationItem } from "./NotificationItem";

function NotificationPanel() {
  const notifications = useNotificationStore((s) => s.notifications);
  const realtimeEvents = useNotificationStore((s) => s.realtimeEvents);
  const isLoading = useNotificationStore((s) => s.isLoading);
  const markAllRead = useNotificationStore((s) => s.markAllRead);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-text">Notifications</h3>
        <button
          onClick={markAllRead}
          className="text-xs text-text-muted hover:text-text transition-colors"
        >
          Mark all read
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-text-muted">Loading...</span>
          </div>
        ) : notifications.length === 0 && realtimeEvents.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-text-muted">No notifications</span>
          </div>
        ) : (
          <div className="space-y-0.5 p-2">
            {notifications.map((n) => (
              <NotificationItem key={n.id} notification={n} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { NotificationPanel };
