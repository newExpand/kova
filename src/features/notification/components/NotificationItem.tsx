import { type HookType, parseHookType } from "../types";
import type { NotificationRecord } from "../types";
import { cn } from "../../../lib/utils";

interface NotificationItemProps {
  notification: NotificationRecord;
}

const hookTypeColors: Record<HookType, string> = {
  PreToolUse: "bg-warning",
  PostToolUse: "bg-success",
  Stop: "bg-danger",
  SubagentStop: "bg-project-6",
  Unknown: "bg-text-muted",
};

const hookTypeLabels: Record<HookType, string> = {
  PreToolUse: "Pre",
  PostToolUse: "Post",
  Stop: "Stop",
  SubagentStop: "Sub",
  Unknown: "?",
};

function NotificationItem({ notification }: NotificationItemProps) {
  const hookType = parseHookType(notification.eventType);
  const time = new Date(notification.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex items-start gap-3 rounded-md px-3 py-2 transition-colors hover:bg-surface-hover">
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white",
          hookTypeColors[hookType],
        )}
      >
        {hookTypeLabels[hookType]}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text">{notification.title}</p>
        {notification.message && (
          <p className="truncate text-xs text-text-secondary">
            {notification.message}
          </p>
        )}
        <span className="text-xs text-text-muted">{time}</span>
      </div>
    </div>
  );
}

export { NotificationItem };
