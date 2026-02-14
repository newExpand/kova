import type { TerminalTheme } from "./types";
import { tokyonightNight } from "./presets/tokyonight-night";
import { tokyonightStorm } from "./presets/tokyonight-storm";
import { dracula } from "./presets/dracula";
import { catppuccinMocha } from "./presets/catppuccin-mocha";
import { solarizedDark } from "./presets/solarized-dark";
import { nord } from "./presets/nord";
import { oneDark } from "./presets/one-dark";
import { gruvboxDark } from "./presets/gruvbox-dark";
import { rosePineMoon } from "./presets/rose-pine-moon";
import { kanagawa } from "./presets/kanagawa";
import { everforestDark } from "./presets/everforest-dark";
import { githubDarkDimmed } from "./presets/github-dark-dimmed";

export const DEFAULT_THEME_ID = "tokyonight-night";

export const THEME_LIST: TerminalTheme[] = [
  tokyonightNight,
  tokyonightStorm,
  dracula,
  catppuccinMocha,
  solarizedDark,
  nord,
  oneDark,
  gruvboxDark,
  rosePineMoon,
  kanagawa,
  everforestDark,
  githubDarkDimmed,
];

const themeMap = new Map<string, TerminalTheme>(
  THEME_LIST.map((t) => [t.id, t]),
);

/** Returns the theme for the given ID, or the default theme if not found. */
export function getThemeById(id: string): TerminalTheme {
  const theme = themeMap.get(id);
  if (!theme) {
    console.warn(
      `[themes] Unknown theme ID "${id}", falling back to "${DEFAULT_THEME_ID}".`,
    );
    return tokyonightNight;
  }
  return theme;
}

export interface ThemeGroup {
  group: string;
  themes: TerminalTheme[];
}

/** Themes grouped by their `group` field, preserving insertion order. */
export const THEME_GROUPS: ThemeGroup[] = (() => {
  const groups: ThemeGroup[] = [];
  const seen = new Map<string, ThemeGroup>();
  for (const theme of THEME_LIST) {
    let entry = seen.get(theme.group);
    if (!entry) {
      entry = { group: theme.group, themes: [] };
      seen.set(theme.group, entry);
      groups.push(entry);
    }
    entry.themes.push(theme);
  }
  return groups;
})();

export type { TerminalTheme, TerminalThemeUI } from "./types";
export { applyThemeCSS, getSwatchColors } from "./utils";
