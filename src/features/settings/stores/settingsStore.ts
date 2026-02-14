import { create } from "zustand";
import { getSetting, setSetting } from "../../../lib/tauri/commands";
import {
  DEFAULT_THEME_ID,
  getThemeById,
  applyThemeCSS,
} from "../../terminal";
import type { NotificationStyle } from "../types";

interface SettingsState {
  notificationStyle: NotificationStyle;
  terminalTheme: string;
  isLoading: boolean;
  error: string | null;
}

interface SettingsActions {
  fetchSettings: () => Promise<void>;
  setNotificationStyle: (style: NotificationStyle) => Promise<void>;
  setTerminalTheme: (themeId: string) => Promise<void>;
  reset: () => void;
}

const initialState: SettingsState = {
  notificationStyle: "alert",
  terminalTheme: DEFAULT_THEME_ID,
  isLoading: false,
  error: null,
};

function extractErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  (set, get) => ({
    ...initialState,

    fetchSettings: async () => {
      set({ isLoading: true, error: null });
      try {
        const [style, themeId] = await Promise.all([
          getSetting("notification_style", "alert"),
          getSetting("terminal_theme", DEFAULT_THEME_ID),
        ]);
        const theme = getThemeById(themeId);
        applyThemeCSS(theme);
        set({
          notificationStyle: style as NotificationStyle,
          terminalTheme: theme.id,
          isLoading: false,
        });
      } catch (e) {
        console.error("[settingsStore] Failed to fetch settings:", e);
        set({ error: extractErrorMessage(e), isLoading: false });
      }
    },

    setNotificationStyle: async (style) => {
      set({ isLoading: true, error: null });
      try {
        await setSetting("notification_style", style);
        set({ notificationStyle: style, isLoading: false });
      } catch (e) {
        console.error("[settingsStore] Failed to save notification style:", e);
        set({ error: extractErrorMessage(e), isLoading: false });
      }
    },

    setTerminalTheme: async (themeId) => {
      const theme = getThemeById(themeId);
      const prevThemeId = get().terminalTheme;
      applyThemeCSS(theme);
      set({ terminalTheme: theme.id, error: null, isLoading: true });
      try {
        await setSetting("terminal_theme", theme.id);
        set({ isLoading: false });
      } catch (e) {
        console.error("[settingsStore] Failed to save theme:", e);
        // Rollback: restore previous theme
        const prevTheme = getThemeById(prevThemeId);
        applyThemeCSS(prevTheme);
        set({
          terminalTheme: prevThemeId,
          error: extractErrorMessage(e),
          isLoading: false,
        });
      }
    },

    reset: () => set(initialState),
  }),
);
