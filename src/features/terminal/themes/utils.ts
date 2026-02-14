import type { ITheme } from "@xterm/xterm";
import type { TerminalTheme } from "./types";
import type { GlassMode } from "../../settings/types";

/** hex (#RRGGBB or #RGB) → rgba string */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  let r: number, g: number, b: number;
  if (h.length === 3) {
    r = parseInt(h.slice(0, 1).repeat(2), 16);
    g = parseInt(h.slice(1, 2).repeat(2), 16);
    b = parseInt(h.slice(2, 3).repeat(2), 16);
  } else {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}

/** Returns a new ITheme with its background converted to RGBA at the given opacity.
 *  All other theme colors remain unchanged. */
export function applyOpacityToTheme(theme: ITheme, opacity: number): ITheme {
  const bg = theme.background ?? "#1a1b26";
  return {
    ...theme,
    background: hexToRgba(bg, opacity),
  };
}

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

/**
 * W3C WCAG relative luminance (0 = black, 1 = white).
 * Used to distinguish "nearly black" cells from colored/bright ones in glass mode.
 * @see https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function relativeLuminance(r: number, g: number, b: number): number {
  const linearize = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return (
    0.2126 * linearize(r / 255) +
    0.7152 * linearize(g / 255) +
    0.0722 * linearize(b / 255)
  );
}

/** hex (#RRGGBB or #RGB) → { r, g, b } object */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return {
      r: parseInt(h.slice(0, 1).repeat(2), 16),
      g: parseInt(h.slice(1, 2).repeat(2), 16),
      b: parseInt(h.slice(2, 3).repeat(2), 16),
    };
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// Standard ANSI base-16 fallback colors
const ANSI_BASE16_DEFAULTS = [
  "#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
  "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
];

// 6x6x6 cube axis values
const CUBE_LEVELS = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

/** Generates the full 256-color ANSI palette as {r,g,b} tuples, respecting theme overrides. */
function generateAnsi256Palette(theme: ITheme): { r: number; g: number; b: number }[] {
  const palette: { r: number; g: number; b: number }[] = [];

  // 0-15: base 16 from theme, with standard fallback
  const themeBase16: (string | undefined)[] = [
    theme.black, theme.red, theme.green, theme.yellow,
    theme.blue, theme.magenta, theme.cyan, theme.white,
    theme.brightBlack, theme.brightRed, theme.brightGreen, theme.brightYellow,
    theme.brightBlue, theme.brightMagenta, theme.brightCyan, theme.brightWhite,
  ];
  for (let i = 0; i < 16; i++) {
    const hex = themeBase16[i] ?? ANSI_BASE16_DEFAULTS[i] ?? "#000000";
    palette.push(hexToRgb(hex));
  }

  // 16-231: 6x6x6 color cube
  for (let ri = 0; ri < 6; ri++) {
    for (let gi = 0; gi < 6; gi++) {
      for (let bi = 0; bi < 6; bi++) {
        palette.push({
          r: CUBE_LEVELS[ri] ?? 0,
          g: CUBE_LEVELS[gi] ?? 0,
          b: CUBE_LEVELS[bi] ?? 0,
        });
      }
    }
  }

  // 232-255: grayscale ramp
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    palette.push({ r: v, g: v, b: v });
  }

  // Apply theme.extendedAnsi overrides if present
  if (theme.extendedAnsi) {
    for (let i = 0; i < theme.extendedAnsi.length && i < 256; i++) {
      const extHex = theme.extendedAnsi[i];
      if (extHex) palette[i] = hexToRgb(extHex);
    }
  }

  return palette;
}

const STYLE_ELEMENT_ID = "xterm-glass-bg-overrides";

/**
 * Injects or clears CSS rules that override `.xterm-bg-N` background colors
 * with semi-transparent RGBA values for glass mode.
 * Foreground classes (`.xterm-fg-N`) are never touched.
 */
export function updateGlassBgOverrides(
  theme: ITheme,
  glassMode: GlassMode,
  opacity: number,
): void {
  if (typeof document === "undefined") return;

  let styleEl = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ELEMENT_ID;
    document.head.appendChild(styleEl);
  }

  if (glassMode === "opaque") {
    styleEl.textContent = "";
    return;
  }

  // Luminance threshold: colors below this are "nearly black" and become
  // transparent so the themed .xterm-scrollable-element background shows through.
  const DARK_LUMINANCE_THRESHOLD = 0.05;

  const palette = generateAnsi256Palette(theme);
  const rules: string[] = [];
  for (let i = 0; i < 256; i++) {
    const color = palette[i];
    if (!color) continue;
    const { r, g, b } = color;
    const lum = relativeLuminance(r, g, b);
    const bg =
      lum < DARK_LUMINANCE_THRESHOLD
        ? "transparent"
        : `rgba(${r},${g},${b},${opacity})`;
    rules.push(
      `.terminal-glass .xterm-bg-${i} { background-color: ${bg} !important; }`,
    );
  }
  styleEl.textContent = rules.join("\n");
}
