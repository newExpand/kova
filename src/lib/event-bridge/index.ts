import type { UnlistenFn } from "@tauri-apps/api/event";
import { setupNotificationEvents } from "./notification-events";

let unlisteners: UnlistenFn[] = [];

export async function initEventBridge(): Promise<void> {
  const notifUnlisten = await setupNotificationEvents();
  unlisteners.push(notifUnlisten);
}

export function destroyEventBridge(): void {
  for (const fn of unlisteners) {
    fn();
  }
  unlisteners = [];
}
