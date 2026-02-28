import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "../../stores/appStore";

import type { HookType } from "../../features/notification/types";

export interface HookEvent {
  projectPath: string;
  eventType: HookType;
  payload: unknown;
  timestamp: string;
}

/** Sets up only the notification:clicked listener (hook-received is unified in index.ts) */
export async function setupNotificationClickEvents(): Promise<UnlistenFn[]> {
  const clickUnlisten = await listen<string>(
    "notification:clicked",
    (event) => {
      useAppStore.getState().setPendingProjectNavigation(event.payload);
    },
  );
  return [clickUnlisten];
}
