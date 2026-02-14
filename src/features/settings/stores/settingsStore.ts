import { create } from "zustand";
import { getSetting, setSetting } from "../../../lib/tauri/commands";
import type { NotificationStyle } from "../types";

interface SettingsState {
  notificationStyle: NotificationStyle;
  isLoading: boolean;
  error: string | null;
}

interface SettingsActions {
  fetchSettings: () => Promise<void>;
  setNotificationStyle: (style: NotificationStyle) => Promise<void>;
  reset: () => void;
}

const initialState: SettingsState = {
  notificationStyle: "alert",
  isLoading: false,
  error: null,
};

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  (set) => ({
    ...initialState,

    fetchSettings: async () => {
      set({ isLoading: true, error: null });
      try {
        const style = await getSetting("notification_style", "alert");
        set({
          notificationStyle: style as NotificationStyle,
          isLoading: false,
        });
      } catch (e) {
        set({ error: String(e), isLoading: false });
      }
    },

    setNotificationStyle: async (style) => {
      set({ isLoading: true, error: null });
      try {
        await setSetting("notification_style", style);
        set({ notificationStyle: style, isLoading: false });
      } catch (e) {
        set({ error: String(e), isLoading: false });
      }
    },

    reset: () => set(initialState),
  }),
);
