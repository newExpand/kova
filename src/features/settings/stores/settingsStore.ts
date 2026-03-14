import { create } from "zustand";
import {
  getSetting,
  setSetting,
  getAgentCommands,
  setAgentCommandIpc,
  AGENT_TYPES,
  type AgentType,
} from "../../../lib/tauri/commands";
import { getCachedEnvironment } from "../../environment";
import {
  DEFAULT_THEME_ID,
  getThemeById,
  applyThemeCSS,
  updateGlassBgOverrides,
  DEFAULT_FONT_ID,
  DEFAULT_FONT_SIZE,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
} from "../../terminal";
import type { NotificationStyle, GlassMode } from "../types";

// ---------------------------------------------------------------------------
// Per-key write tracking — prevents race conditions from concurrent writes.
//
// Problem: optimistic update + async persist can race when the same key is
// written multiple times before the first write completes. The second call's
// `prev` value is the first call's optimistic value, not the DB value. If the
// first call fails and rolls back, it clobbers the second call's state.
//
// Solution: each write gets a sequence number. When the async response arrives,
// it only applies the result if it's still the latest write for that key.
// On failure, rollback uses the last successfully persisted value (not the
// optimistic `prev`).
// ---------------------------------------------------------------------------

const writeSeq = new Map<string, number>();
const lastPersisted = new Map<string, string>();

function startWrite(key: string): number {
  const seq = (writeSeq.get(key) ?? 0) + 1;
  writeSeq.set(key, seq);
  return seq;
}

function isStaleWrite(key: string, seq: number): boolean {
  return writeSeq.get(key) !== seq;
}

function markPersisted(key: string, value: string): void {
  lastPersisted.set(key, value);
}

function getPersistedValue(key: string, fallback: string): string {
  return lastPersisted.get(key) ?? fallback;
}

// ---------------------------------------------------------------------------

interface AgentCommandEntry {
  command: string;
  defaultCommand: string;
}

interface SettingsState {
  notificationStyle: NotificationStyle;
  terminalTheme: string;
  terminalGlassMode: GlassMode;
  terminalOpacity: number;
  terminalFontFamily: string;
  terminalFontSize: number;
  copyOnSelect: boolean;
  agentCommands: Record<AgentType, AgentCommandEntry>;
  alerterInstalled: boolean | null;
  isLoading: boolean;
  error: string | null;
}

interface SettingsActions {
  fetchSettings: () => Promise<void>;
  setNotificationStyle: (style: NotificationStyle) => Promise<void>;
  setTerminalTheme: (themeId: string) => Promise<void>;
  setTerminalGlassMode: (mode: GlassMode) => Promise<void>;
  setTerminalOpacity: (opacity: number) => Promise<void>;
  setTerminalFontFamily: (fontId: string) => Promise<void>;
  setTerminalFontSize: (size: number) => Promise<void>;
  setCopyOnSelect: (enabled: boolean) => Promise<void>;
  setAgentCommand: (agentType: AgentType, command: string) => Promise<void>;
  resetAgentCommand: (agentType: AgentType) => void;
  reset: () => void;
}

const VALID_GLASS_MODES: GlassMode[] = ["opaque", "faux"];

function buildDefaultAgentCommands(): Record<AgentType, AgentCommandEntry> {
  const entries = Object.entries(AGENT_TYPES) as [AgentType, (typeof AGENT_TYPES)[AgentType]][];
  return Object.fromEntries(
    entries.map(([key, val]) => [key, { command: val.command, defaultCommand: val.command }]),
  ) as Record<AgentType, AgentCommandEntry>;
}

const initialState: SettingsState = {
  notificationStyle: "alert",
  terminalTheme: DEFAULT_THEME_ID,
  terminalGlassMode: "opaque",
  terminalOpacity: 0.85,
  terminalFontFamily: DEFAULT_FONT_ID,
  terminalFontSize: DEFAULT_FONT_SIZE,
  copyOnSelect: false,
  agentCommands: buildDefaultAgentCommands(),
  alerterInstalled: null,
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
        const [rawStyle, themeId, glassMode, opacityStr, fontFamily, fontSizeStr, copyOnSelectStr, envResult] = await Promise.all([
          getSetting("notification_style", ""),
          getSetting("terminal_theme", DEFAULT_THEME_ID),
          getSetting("terminal_glass_mode", "opaque"),
          getSetting("terminal_opacity", "0.85"),
          getSetting("terminal_font_family", DEFAULT_FONT_ID),
          getSetting("terminal_font_size", String(DEFAULT_FONT_SIZE)),
          getSetting("copy_on_select", "false"),
          getCachedEnvironment().catch((envErr: unknown) => {
            console.error("[settingsStore] Environment check failed, using default notification style:", envErr);
            return null;
          }),
        ]);

        // Dynamic default: alerter detection is non-critical — failure must not break settings
        const detectedAlerter = envResult?.alerterInstalled ?? null;
        const defaultStyle = detectedAlerter === false ? "banner" : "alert";
        const style = rawStyle || defaultStyle;

        // If DB had no value, persist the computed default so backend uses the same style
        let persistedStyle = style;
        if (!rawStyle) {
          try {
            await setSetting("notification_style", defaultStyle);
          } catch {
            // Write failed — DB still empty, backend falls back to "alert"
            persistedStyle = "alert";
          }
        }

        // Seed lastPersisted with DB values so rollback has correct targets
        markPersisted("notification_style", persistedStyle);
        markPersisted("terminal_theme", themeId);
        markPersisted("terminal_glass_mode", glassMode);
        markPersisted("terminal_opacity", opacityStr);
        markPersisted("terminal_font_family", fontFamily);
        markPersisted("terminal_font_size", fontSizeStr);
        markPersisted("copy_on_select", copyOnSelectStr);

        // Fetch agent commands from DB (isolated so failure doesn't discard other settings)
        let agentCommands = { ...initialState.agentCommands };
        try {
          const agentCmds = await getAgentCommands();
          for (const cmd of agentCmds) {
            agentCommands[cmd.agentType] = {
              command: cmd.command,
              defaultCommand: cmd.defaultCommand,
            };
            markPersisted(`agent_command_${cmd.agentType}`, cmd.command);
          }
        } catch (agentErr) {
          console.error("[settingsStore] Failed to fetch agent commands, using defaults:", agentErr);
        }

        const theme = getThemeById(themeId);
        applyThemeCSS(theme);
        const validGlass = VALID_GLASS_MODES.includes(glassMode as GlassMode)
          ? (glassMode as GlassMode)
          : "opaque";
        const parsedOpacity = Math.min(1.0, Math.max(0.5, parseFloat(opacityStr) || 0.85));
        const parsedFontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, parseInt(fontSizeStr, 10) || DEFAULT_FONT_SIZE));
        updateGlassBgOverrides(theme.xterm, validGlass, parsedOpacity);
        set({
          notificationStyle: style as NotificationStyle,
          terminalTheme: theme.id,
          terminalGlassMode: validGlass,
          terminalOpacity: parsedOpacity,
          terminalFontFamily: fontFamily,
          terminalFontSize: parsedFontSize,
          copyOnSelect: copyOnSelectStr === "true",
          agentCommands,
          alerterInstalled: detectedAlerter,
          isLoading: false,
        });
      } catch (e) {
        console.error("[settingsStore] Failed to fetch settings:", e);
        set({ error: extractErrorMessage(e), isLoading: false });
      }
    },

    setNotificationStyle: async (style) => {
      const seq = startWrite("notification_style");
      set({ notificationStyle: style, error: null, isLoading: true });
      try {
        await setSetting("notification_style", style);
        markPersisted("notification_style", style);
        if (isStaleWrite("notification_style", seq)) return;
        set({ isLoading: false });
      } catch (e) {
        if (isStaleWrite("notification_style", seq)) return;
        console.error("[settingsStore] Failed to save notification style:", e);
        const persisted = getPersistedValue("notification_style", "alert");
        set({
          notificationStyle: persisted as NotificationStyle,
          error: extractErrorMessage(e),
          isLoading: false,
        });
      }
    },

    setTerminalTheme: async (themeId) => {
      const seq = startWrite("terminal_theme");
      const theme = getThemeById(themeId);
      applyThemeCSS(theme);
      updateGlassBgOverrides(theme.xterm, get().terminalGlassMode, get().terminalOpacity);
      set({ terminalTheme: theme.id, error: null, isLoading: true });
      try {
        await setSetting("terminal_theme", theme.id);
        markPersisted("terminal_theme", theme.id);
        if (isStaleWrite("terminal_theme", seq)) return;
        set({ isLoading: false });
      } catch (e) {
        if (isStaleWrite("terminal_theme", seq)) return;
        console.error("[settingsStore] Failed to save theme:", e);
        const persistedId = getPersistedValue("terminal_theme", DEFAULT_THEME_ID);
        const prevTheme = getThemeById(persistedId);
        applyThemeCSS(prevTheme);
        updateGlassBgOverrides(prevTheme.xterm, get().terminalGlassMode, get().terminalOpacity);
        set({
          terminalTheme: persistedId,
          error: extractErrorMessage(e),
          isLoading: false,
        });
      }
    },

    setTerminalGlassMode: async (mode) => {
      const seq = startWrite("terminal_glass_mode");
      set({ terminalGlassMode: mode, error: null, isLoading: true });
      updateGlassBgOverrides(getThemeById(get().terminalTheme).xterm, mode, get().terminalOpacity);
      try {
        await setSetting("terminal_glass_mode", mode);
        markPersisted("terminal_glass_mode", mode);
        if (isStaleWrite("terminal_glass_mode", seq)) return;
        set({ isLoading: false });
      } catch (e) {
        if (isStaleWrite("terminal_glass_mode", seq)) return;
        console.error("[settingsStore] Failed to save glass mode:", e);
        const persisted = getPersistedValue("terminal_glass_mode", "opaque") as GlassMode;
        updateGlassBgOverrides(getThemeById(get().terminalTheme).xterm, persisted, get().terminalOpacity);
        set({
          terminalGlassMode: persisted,
          error: extractErrorMessage(e),
          isLoading: false,
        });
      }
    },

    setTerminalOpacity: async (opacity) => {
      const seq = startWrite("terminal_opacity");
      const clamped = Math.min(1.0, Math.max(0.5, opacity));
      set({ terminalOpacity: clamped, error: null, isLoading: true });
      updateGlassBgOverrides(getThemeById(get().terminalTheme).xterm, get().terminalGlassMode, clamped);
      try {
        await setSetting("terminal_opacity", String(clamped));
        markPersisted("terminal_opacity", String(clamped));
        if (isStaleWrite("terminal_opacity", seq)) return;
        set({ isLoading: false });
      } catch (e) {
        if (isStaleWrite("terminal_opacity", seq)) return;
        console.error("[settingsStore] Failed to save opacity:", e);
        const persisted = parseFloat(getPersistedValue("terminal_opacity", "0.85")) || 0.85;
        updateGlassBgOverrides(getThemeById(get().terminalTheme).xterm, get().terminalGlassMode, persisted);
        set({
          terminalOpacity: persisted,
          error: extractErrorMessage(e),
          isLoading: false,
        });
      }
    },

    setTerminalFontFamily: async (fontId) => {
      const seq = startWrite("terminal_font_family");
      set({ terminalFontFamily: fontId, error: null, isLoading: true });
      try {
        await setSetting("terminal_font_family", fontId);
        markPersisted("terminal_font_family", fontId);
        if (isStaleWrite("terminal_font_family", seq)) return;
        set({ isLoading: false });
      } catch (e) {
        if (isStaleWrite("terminal_font_family", seq)) return;
        console.error("[settingsStore] Failed to save font family:", e);
        const persisted = getPersistedValue("terminal_font_family", DEFAULT_FONT_ID);
        set({
          terminalFontFamily: persisted,
          error: extractErrorMessage(e),
          isLoading: false,
        });
      }
    },

    setTerminalFontSize: async (size) => {
      const seq = startWrite("terminal_font_size");
      const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size));
      set({ terminalFontSize: clamped, error: null, isLoading: true });
      try {
        await setSetting("terminal_font_size", String(clamped));
        markPersisted("terminal_font_size", String(clamped));
        if (isStaleWrite("terminal_font_size", seq)) return;
        set({ isLoading: false });
      } catch (e) {
        if (isStaleWrite("terminal_font_size", seq)) return;
        console.error("[settingsStore] Failed to save font size:", e);
        const persisted = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN,
          parseInt(getPersistedValue("terminal_font_size", String(DEFAULT_FONT_SIZE)), 10) || DEFAULT_FONT_SIZE));
        set({
          terminalFontSize: persisted,
          error: extractErrorMessage(e),
          isLoading: false,
        });
      }
    },

    setCopyOnSelect: async (enabled) => {
      const seq = startWrite("copy_on_select");
      set({ copyOnSelect: enabled, error: null, isLoading: true });
      try {
        await setSetting("copy_on_select", String(enabled));
        markPersisted("copy_on_select", String(enabled));
        if (isStaleWrite("copy_on_select", seq)) return;
        set({ isLoading: false });
      } catch (e) {
        if (isStaleWrite("copy_on_select", seq)) return;
        console.error("[settingsStore] Failed to save copy_on_select:", e);
        const persisted = getPersistedValue("copy_on_select", "false") === "true";
        set({
          copyOnSelect: persisted,
          error: extractErrorMessage(e),
          isLoading: false,
        });
      }
    },

    setAgentCommand: async (agentType, command) => {
      const writeKey = `agent_command_${agentType}`;
      const seq = startWrite(writeKey);
      const current = get().agentCommands;
      const entry = current[agentType];
      const effectiveCommand = command.trim() || entry.defaultCommand;

      set({
        agentCommands: {
          ...current,
          [agentType]: { ...entry, command: effectiveCommand },
        },
        error: null,
        isLoading: true,
      });
      try {
        await setAgentCommandIpc(agentType, effectiveCommand);
        markPersisted(writeKey, effectiveCommand);
        if (isStaleWrite(writeKey, seq)) return;
        set({ isLoading: false });
      } catch (e) {
        if (isStaleWrite(writeKey, seq)) return;
        console.error(`[settingsStore] Failed to save agent command (${agentType}):`, e);
        const persisted = getPersistedValue(writeKey, entry.defaultCommand);
        set({
          agentCommands: {
            ...get().agentCommands,
            [agentType]: { ...entry, command: persisted },
          },
          error: extractErrorMessage(e),
          isLoading: false,
        });
      }
    },

    resetAgentCommand: (agentType) => {
      const defaultCmd = get().agentCommands[agentType].defaultCommand;
      get().setAgentCommand(agentType, defaultCmd);
    },

    reset: () => set(initialState),
  }),
);
