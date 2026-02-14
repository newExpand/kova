// Types
export type { TerminalStatus, TerminalConfig, PaneAction } from "./types";

// Store
export { useTerminalStore } from "./stores/terminalStore";

// Components
export { TerminalView } from "./components/TerminalView";
export { TerminalPage } from "./components/TerminalPage";
export { PaneToolbar } from "./components/PaneToolbar";
export { WindowToolbar } from "./components/WindowToolbar";
export { NewPaneDialog } from "./components/NewPaneDialog";
export { ThemePickerPanel } from "./components/ThemePickerPanel";

// Hooks
export { useTerminal } from "./hooks/useTerminal";

// Themes
export type { TerminalTheme, TerminalThemeUI } from "./themes";
export {
  THEME_LIST,
  DEFAULT_THEME_ID,
  getThemeById,
  THEME_GROUPS,
  applyThemeCSS,
  getSwatchColors,
} from "./themes";
