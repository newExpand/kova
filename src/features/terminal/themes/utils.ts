import type { TerminalTheme } from "./types";

/** Sets CSS custom properties on :root so terminal-related styles
 *  (background, IME composition overlay, drag overlay) follow the theme. */
export function applyThemeCSS(theme: TerminalTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const bg = theme.xterm.background ?? "#1a1b26";
  const props: [string, string | undefined][] = [
    ["--terminal-bg", bg],
    ["--terminal-comp-bg", theme.ui.compositionBackground],
    ["--terminal-comp-fg", theme.ui.compositionForeground],
    ["--terminal-comp-border", theme.ui.compositionBorder],
    ["--terminal-drag-bg", theme.ui.dragOverlayBackground],
  ];
  for (const [name, value] of props) {
    if (!value) {
      console.warn(`[applyThemeCSS] Missing value for ${name} in theme "${theme.id}"`);
      continue;
    }
    root.style.setProperty(name, value);
  }
}

/** Returns 5 representative colors for a theme preview swatch. */
export function getSwatchColors(theme: TerminalTheme): string[] {
  return [
    theme.xterm.background ?? "#000",
    theme.xterm.foreground ?? "#fff",
    theme.xterm.red ?? "#f00",
    theme.xterm.green ?? "#0f0",
    theme.xterm.blue ?? "#00f",
  ];
}
