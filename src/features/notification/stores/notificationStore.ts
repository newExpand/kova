import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { NotificationRecord } from "../types";
import type { HookEvent } from "../../../lib/event-bridge/notification-events";
import * as commands from "../../../lib/tauri/commands";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface NotificationState {
  notifications: NotificationRecord[];
  realtimeEvents: HookEvent[];
  isLoading: boolean;
  error: string | null;
  unreadCount: number;
  isPanelOpen: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface NotificationActions {
  // Data
  fetchNotifications: (projectId: string, limit?: number) => Promise<void>;

  // Realtime
  pushRealtimeEvent: (event: HookEvent) => void;
  clearRealtimeEvents: () => void;

  // UI
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  markAllRead: () => void;

  // Reset
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Combined Store Type
// ---------------------------------------------------------------------------

type NotificationStore = NotificationState & NotificationActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: NotificationState = {
  notifications: [],
  realtimeEvents: [],
  isLoading: false,
  error: null,
  unreadCount: 0,
  isPanelOpen: false,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useNotificationStore = create<NotificationStore>()(
  devtools(
    (set) => ({
      ...initialState,

      fetchNotifications: async (projectId, limit) => {
        set(
          { isLoading: true, error: null },
          undefined,
          "fetchNotifications/start",
        );
        try {
          const notifications = await commands.listProjectNotifications(
            projectId,
            limit,
          );
          set(
            { notifications, isLoading: false },
            undefined,
            "fetchNotifications/success",
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set(
            { error: message, isLoading: false },
            undefined,
            "fetchNotifications/error",
          );
        }
      },

      pushRealtimeEvent: (event) =>
        set(
          (state) => ({
            realtimeEvents: [event, ...state.realtimeEvents].slice(0, 100),
            unreadCount: state.unreadCount + 1,
          }),
          undefined,
          "pushRealtimeEvent",
        ),

      clearRealtimeEvents: () =>
        set({ realtimeEvents: [] }, undefined, "clearRealtimeEvents"),

      togglePanel: () =>
        set(
          (state) => ({ isPanelOpen: !state.isPanelOpen }),
          undefined,
          "togglePanel",
        ),

      setPanelOpen: (open) =>
        set({ isPanelOpen: open }, undefined, "setPanelOpen"),

      markAllRead: () =>
        set({ unreadCount: 0 }, undefined, "markAllRead"),

      reset: () => set(initialState, undefined, "reset"),
    }),
    { name: "NotificationStore" },
  ),
);
