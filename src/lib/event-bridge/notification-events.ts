import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNotificationStore } from "../../features/notification";
import { useAppStore } from "../../stores/appStore";

export interface HookEvent {
  projectPath: string;
  eventType: string;
  payload: unknown;
  timestamp: string;
}

export async function setupNotificationEvents(): Promise<UnlistenFn[]> {
  const hookUnlisten = await listen<HookEvent>(
    "notification:hook-received",
    (event) => {
      useNotificationStore.getState().pushRealtimeEvent(event.payload);
    },
  );

  const clickUnlisten = await listen<string>(
    "notification:clicked",
    (event) => {
      useAppStore.getState().setPendingProjectNavigation(event.payload);
    },
  );

  return [hookUnlisten, clickUnlisten];
}
