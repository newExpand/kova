import { create } from "zustand";
import { getSetting, setSetting } from "../../../lib/tauri/commands";
import {
  DEFAULT_THEME_ID,
  getThemeById,
  applyThemeCSS,
  updateGlassBgOverrides,
} from "../../terminal";
import type { NotificationStyle, GlassMode } from "../types";

interface SettingsState {
  notificationStyle: NotificationStyle;
  terminalTheme: string;
  terminalGlassMode: GlassMode;
  terminalOpacity: number;
  isLoading: boolean;
  error: string | null;
}

interface SettingsActions {
  fetchSettings: () => Promise<void>;
  setNotificationStyle: (style: NotificationStyle) => Promise<void>;
  setTerminalTheme: (themeId: string) => Promise<void>;
  setTerminalGlassMode: (mode: GlassMode) => Promise<void>;
  setTerminalOpacity: (opacity: number) => Promise<void>;
  reset: () => void;
}

const VALID_GLASS_MODES: GlassMode[] = ["opaque", "faux"];

const initialState: SettingsState = {
  notificationStyle: "alert",
  terminalTheme: DEFAULT_THEME_ID,
  terminalGlassMode: "opaque",
  terminalOpacity: 0.85,
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
        const [style, themeId, glassMode, opacityStr] = await Promise.all([
          getSetting("notification_style", "alert"),
          getSetting("terminal_theme", DEFAULT_THEME_ID),
          getSetting("terminal_glass_mode", "opaque"),
          getSetting("terminal_opacity", "0.85"),
        ]);
        const theme = getThemeById(themeId);
        applyThemeCSS(theme);
        const validGlass = VALID_GLASS_MODES.includes(glassMode as GlassMode)
          ? (glassMode as GlassMode)
          : "opaque";
        const parsedOpacity = Math.min(1.0, Math.max(0.5, parseFloat(opacityStr) || 0.85));
        updateGlassBgOverrides(theme.xterm, validGlass, parsedOpacity);
        set({
          notificationStyle: style as NotificationStyle,
          terminalTheme: theme.id,
          terminalGlassMode: validGlass,
          terminalOpacity: parsedOpacity,
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
      updateGlassBgOverrides(theme.xterm, get().terminalGlassMode, get().terminalOpacity);
      set({ terminalTheme: theme.id, error: null, isLoading: true });
      try {
        await setSetting("terminal_theme", theme.id);
        set({ isLoading: false });
      } catch (e) {
        console.error("[settingsStore] Failed to save theme:", e);
        // Rollback: restore previous theme
        const prevTheme = getThemeById(prevThemeId);
        applyThemeCSS(prevTheme);
        updateGlassBgOverrides(prevTheme.xterm, get().terminalGlassMode, get().terminalOpacity);
        set({
          terminalTheme: prevThemeId,
          error: extractErrorMessage(e),
          isLoading: false,
        });
      }
    },

    setTerminalGlassMode: async (mode) => {
      const prev = get().terminalGlassMode;
      set({ terminalGlassMode: mode, error: null, isLoading: true });
      updateGlassBgOverrides(getThemeById(get().terminalTheme).xterm, mode, get().terminalOpacity);
      try {
        await setSetting("terminal_glass_mode", mode);
        set({ isLoading: false });
      } catch (e) {
        console.error("[settingsStore] Failed to save glass mode:", e);
        set({
          terminalGlassMode: prev,
          error: extractErrorMessage(e),
          isLoading: false,
        });
      }
    },

    setTerminalOpacity: async (opacity) => {
      const clamped = Math.min(1.0, Math.max(0.5, opacity));
      const prev = get().terminalOpacity;
      set({ terminalOpacity: clamped, error: null, isLoading: true });
      updateGlassBgOverrides(getThemeById(get().terminalTheme).xterm, get().terminalGlassMode, clamped);
      try {
        await setSetting("terminal_opacity", String(clamped));
        set({ isLoading: false });
      } catch (e) {
        console.error("[settingsStore] Failed to save opacity:", e);
        set({
          terminalOpacity: prev,
          error: extractErrorMessage(e),
          isLoading: false,
        });
      }
    },

    reset: () => set(initialState),
  }),
);
