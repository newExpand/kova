import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "../../stores/appStore";

import type { HookType } from "../../features/notification/types";

export interface HookEvent {
  projectPath: string;
  eventType: HookType;
  payload: unknown;
  timestamp: string;
}

/** notification:clicked 리스너만 설정 (hook-received는 index.ts에서 통합) */
export async function setupNotificationClickEvents(): Promise<UnlistenFn[]> {
  const clickUnlisten = await listen<string>(
    "notification:clicked",
    (event) => {
      useAppStore.getState().setPendingProjectNavigation(event.payload);
    },
  );
  return [clickUnlisten];
}
