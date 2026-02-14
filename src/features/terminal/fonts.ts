// ── Terminal Font Presets ──
// Popular monospace fonts for terminal use (2025-2026).
// "system" fonts ship with macOS; "popular" fonts are bundled via fontsource
// and loaded on-demand via dynamic CSS import.

export interface FontPreset {
  id: string;
  name: string;
  fontFamily: string;
  category: "system" | "popular";
}

export const DEFAULT_FONT_ID = "sf-mono";
export const DEFAULT_FONT_SIZE = 14;
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;

export const FONT_PRESETS: FontPreset[] = [
  // ── System (macOS built-in) ──
  { id: "sf-mono", name: "SF Mono", fontFamily: "'SF Mono', monospace", category: "system" },
  { id: "menlo", name: "Menlo", fontFamily: "Menlo, monospace", category: "system" },
  { id: "monaco", name: "Monaco", fontFamily: "Monaco, monospace", category: "system" },
  // ── Popular (bundled via fontsource) ──
  { id: "fira-code", name: "Fira Code", fontFamily: "'Fira Code', monospace", category: "popular" },
  { id: "jetbrains-mono", name: "JetBrains Mono", fontFamily: "'JetBrains Mono', monospace", category: "popular" },
  { id: "source-code-pro", name: "Source Code Pro", fontFamily: "'Source Code Pro', monospace", category: "popular" },
  { id: "cascadia-code", name: "Cascadia Code", fontFamily: "'Cascadia Code', monospace", category: "popular" },
  { id: "ibm-plex-mono", name: "IBM Plex Mono", fontFamily: "'IBM Plex Mono', monospace", category: "popular" },
  { id: "iosevka", name: "Iosevka", fontFamily: "Iosevka, monospace", category: "popular" },
  { id: "monaspace-neon", name: "Monaspace Neon", fontFamily: "'Monaspace Neon', monospace", category: "popular" },
  { id: "ubuntu-mono", name: "Ubuntu Mono", fontFamily: "'Ubuntu Mono', monospace", category: "popular" },
];

const fontMap = new Map(FONT_PRESETS.map((f) => [f.id, f]));

export function getFontById(id: string): FontPreset {
  return fontMap.get(id) ?? fontMap.get(DEFAULT_FONT_ID)!;
}

/** Check whether a font family is available on this system via the CSS Font Loading API. */
export function isFontAvailable(fontFamily: string): boolean {
  try {
    return document.fonts.check(`16px ${fontFamily}`);
  } catch {
    return false;
  }
}

// ── Fontsource dynamic import ──
// Each popular font has a fontsource package bundled with the app.
// Dynamic import() loads the 400-weight CSS on demand, which registers
// @font-face rules pointing to local woff2 files in the bundle.

const fontsourceImportMap: Record<string, () => Promise<unknown>> = {
  "fira-code": () => import("@fontsource/fira-code/400.css"),
  "jetbrains-mono": () => import("@fontsource/jetbrains-mono/400.css"),
  "source-code-pro": () => import("@fontsource/source-code-pro/400.css"),
  "cascadia-code": () => import("@fontsource/cascadia-code/400.css"),
  "ibm-plex-mono": () => import("@fontsource/ibm-plex-mono/400.css"),
  "iosevka": () => import("@fontsource/iosevka/400.css"),
  "monaspace-neon": () => import("@fontsource/monaspace-neon/400.css"),
  "ubuntu-mono": () => import("@fontsource/ubuntu-mono/400.css"),
};

const loadedFontIds = new Set<string>();

/**
 * Load a font's @font-face CSS via dynamic import (fontsource).
 * System fonts skip this step. Idempotent — subsequent calls return immediately.
 */
export async function loadFontCss(preset: FontPreset): Promise<boolean> {
  if (preset.category === "system") return true;
  if (loadedFontIds.has(preset.id)) return true;

  const loader = fontsourceImportMap[preset.id];
  if (!loader) return false;

  try {
    await loader();
    loadedFontIds.add(preset.id);
    return true;
  } catch (e) {
    console.error(`[fonts] Failed to load fontsource CSS for ${preset.name}:`, e);
    return false;
  }
}

export const FONT_GROUPS: { group: string; fonts: FontPreset[] }[] = [
  { group: "System", fonts: FONT_PRESETS.filter((f) => f.category === "system") },
  { group: "Popular", fonts: FONT_PRESETS.filter((f) => f.category === "popular") },
];
