import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNotificationStore } from "../../features/notification";

export interface HookEvent {
  projectPath: string;
  eventType: string;
  payload: unknown;
  timestamp: string;
}

export async function setupNotificationEvents(): Promise<UnlistenFn> {
  return listen<HookEvent>("notification:hook-received", (event) => {
    useNotificationStore.getState().pushRealtimeEvent(event.payload);
  });
}
