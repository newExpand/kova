import type { ITheme } from "@xterm/xterm";

export interface TerminalThemeUI {
  compositionBackground: string;
  compositionForeground: string;
  compositionBorder: string;
  dragOverlayBackground: string;
}

export interface TerminalTheme {
  id: string;
  name: string;
  group: string;
  variant: "dark" | "light";
  xterm: ITheme;
  ui: TerminalThemeUI;
}
