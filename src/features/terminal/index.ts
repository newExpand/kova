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

// Hooks
export { useTerminal } from "./hooks/useTerminal";
