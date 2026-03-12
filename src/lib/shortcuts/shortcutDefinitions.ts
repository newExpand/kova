// ---------------------------------------------------------------------------
// Shortcut Registry — declarative definitions of all keyboard shortcuts.
// Handlers remain in their respective components; this file is the single
// source of truth for *what* shortcuts exist, used by the help modal and
// any UI that displays shortcut hints.
// ---------------------------------------------------------------------------

export type ShortcutCategory =
  | "general"
  | "navigation"
  | "panel"
  | "terminal"
  | "tmux"
  | "editor";

export type ShortcutId =
  | "command-palette"
  | "new-project"
  | "shortcuts-help"
  | "project-switch"
  | "toggle-git"
  | "toggle-sidebar"
  | "file-search"
  | "content-search"
  | "toggle-file-viewer"
  | "maximize-file-viewer"
  | "terminal-copy"
  | "terminal-paste"
  | "terminal-select-all"
  | "terminal-home"
  | "terminal-end"
  | "copy-on-select"
  | "tmux-new-window"
  | "tmux-close-window"
  | "tmux-next-window"
  | "tmux-prev-window"
  | "tmux-split-horizontal"
  | "tmux-split-vertical"
  | "tmux-close-pane"
  | "toggle-sidebar-tab"
  | "editor-open-file"
  | "editor-open-url";

export interface ShortcutDefinition {
  id: ShortcutId;
  /** The `event.key` value (lowercase) or special identifier like "Mouse Drag" */
  key: string;
  modifiers: {
    meta: boolean;
    shift?: boolean;
    alt?: boolean;
    ctrl?: boolean;
  };
  label: string;
  category: ShortcutCategory;
  /** Optional condition description shown as a small hint */
  when?: string;
}

// ── Category metadata ──────────────────────────────────────────────────────

const CATEGORY_ORDER: ShortcutCategory[] = [
  "general",
  "navigation",
  "panel",
  "terminal",
  "tmux",
  "editor",
];

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  general: "General",
  navigation: "Navigation",
  panel: "Panels",
  terminal: "Terminal",
  tmux: "tmux",
  editor: "Editor",
};

// ── Shortcut definitions ───────────────────────────────────────────────────

export const SHORTCUTS: ShortcutDefinition[] = [
  // ── General ──
  {
    id: "command-palette",
    key: "k",
    modifiers: { meta: true },
    label: "Command Palette",
    category: "general",
  },
  {
    id: "new-project",
    key: "n",
    modifiers: { meta: true },
    label: "New Project",
    category: "general",
  },
  {
    id: "shortcuts-help",
    key: "/",
    modifiers: { meta: true },
    label: "Keyboard Shortcuts",
    category: "general",
  },

  // ── Navigation ──
  {
    id: "project-switch",
    key: "1~9, 0",
    modifiers: { meta: true },
    label: "Quick Project Switch",
    category: "navigation",
  },
  {
    id: "toggle-sidebar-tab",
    key: "j",
    modifiers: { meta: true },
    label: "Projects ↔ Agents",
    category: "navigation",
  },
  {
    id: "toggle-git",
    key: "g",
    modifiers: { meta: true, shift: true },
    label: "Terminal ↔ Git Graph",
    category: "navigation",
  },

  // ── Panel ──
  {
    id: "toggle-sidebar",
    key: "b",
    modifiers: { meta: true },
    label: "Toggle Sidebar",
    category: "panel",
  },
  {
    id: "file-search",
    key: "p",
    modifiers: { meta: true },
    label: "File Search",
    category: "panel",
    when: "Requires project",
  },
  {
    id: "content-search",
    key: "f",
    modifiers: { meta: true, shift: true },
    label: "Search in Files",
    category: "panel",
    when: "Requires project",
  },
  {
    id: "toggle-file-viewer",
    key: "\\",
    modifiers: { meta: true },
    label: "Toggle File Viewer",
    category: "panel",
    when: "Requires project",
  },
  {
    id: "maximize-file-viewer",
    key: "\\",
    modifiers: { meta: true, shift: true },
    label: "Maximize File Viewer",
    category: "panel",
    when: "Requires project",
  },

  // ── Terminal ──
  {
    id: "terminal-copy",
    key: "c",
    modifiers: { meta: true },
    label: "Copy Selection",
    category: "terminal",
  },
  {
    id: "terminal-paste",
    key: "v",
    modifiers: { meta: true },
    label: "Paste",
    category: "terminal",
  },
  {
    id: "terminal-select-all",
    key: "a",
    modifiers: { meta: true },
    label: "Select All",
    category: "terminal",
  },
  {
    id: "terminal-home",
    key: "←",
    modifiers: { meta: true },
    label: "Move to Line Start",
    category: "terminal",
  },
  {
    id: "terminal-end",
    key: "→",
    modifiers: { meta: true },
    label: "Move to Line End",
    category: "terminal",
  },
  {
    id: "copy-on-select",
    key: "Mouse Drag",
    modifiers: { meta: false },
    label: "Copy on Select",
    category: "terminal",
    when: "When enabled in settings",
  },

  // ── tmux ──
  {
    id: "tmux-new-window",
    key: "t",
    modifiers: { meta: true },
    label: "New Window",
    category: "tmux",
    when: "Requires tmux session",
  },
  {
    id: "tmux-close-window",
    key: "w",
    modifiers: { meta: true, shift: true },
    label: "Close Window",
    category: "tmux",
    when: "Requires tmux session",
  },
  {
    id: "tmux-next-window",
    key: "]",
    modifiers: { meta: true, shift: true },
    label: "Next Window",
    category: "tmux",
    when: "Requires tmux session",
  },
  {
    id: "tmux-prev-window",
    key: "[",
    modifiers: { meta: true, shift: true },
    label: "Previous Window",
    category: "tmux",
    when: "Requires tmux session",
  },
  {
    id: "tmux-split-horizontal",
    key: "d",
    modifiers: { meta: true, shift: true },
    label: "Split Horizontal",
    category: "tmux",
    when: "Requires tmux session",
  },
  {
    id: "tmux-split-vertical",
    key: "d",
    modifiers: { meta: true },
    label: "Split Vertical",
    category: "tmux",
    when: "Requires tmux session",
  },
  {
    id: "tmux-close-pane",
    key: "w",
    modifiers: { meta: true },
    label: "Close Pane",
    category: "tmux",
    when: "Requires tmux session",
  },

  // ── Editor ──
  {
    id: "editor-open-file",
    key: "Click",
    modifiers: { meta: true },
    label: "Open File Path",
    category: "editor",
    when: "File path in terminal",
  },
  {
    id: "editor-open-url",
    key: "Click",
    modifiers: { meta: true },
    label: "Open URL",
    category: "editor",
    when: "URL in terminal",
  },
];

// ── Utility functions ──────────────────────────────────────────────────────

const MODIFIER_SYMBOLS = {
  meta: "⌘",
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
} as const;

const KEY_DISPLAY_MAP: Record<string, string> = {
  "\\": "\\",
  "ArrowLeft": "←",
  "ArrowRight": "→",
  "ArrowUp": "↑",
  "ArrowDown": "↓",
  "/": "/",
  "Enter": "↵",
  "Escape": "Esc",
  "Backspace": "⌫",
  "Delete": "⌦",
  "Tab": "⇥",
  " ": "Space",
};

/** Format a shortcut definition into a human-readable string like "⌘⇧G" */
export function formatShortcut(def: ShortcutDefinition): string {
  const parts: string[] = [];

  if (def.modifiers.ctrl) parts.push(MODIFIER_SYMBOLS.ctrl);
  if (def.modifiers.alt) parts.push(MODIFIER_SYMBOLS.alt);
  if (def.modifiers.shift) parts.push(MODIFIER_SYMBOLS.shift);
  if (def.modifiers.meta) parts.push(MODIFIER_SYMBOLS.meta);

  const displayKey = KEY_DISPLAY_MAP[def.key] ?? def.key.toUpperCase();
  parts.push(displayKey);

  return parts.join("");
}

/** Get all shortcuts grouped by category in display order */
export function getShortcutsByCategory(): [ShortcutCategory, ShortcutDefinition[]][] {
  return CATEGORY_ORDER
    .map((cat) => [cat, SHORTCUTS.filter((s) => s.category === cat)] as [ShortcutCategory, ShortcutDefinition[]])
    .filter(([, items]) => items.length > 0);
}

/** Get the localized label for a category */
export function getCategoryLabel(category: ShortcutCategory): string {
  return CATEGORY_LABELS[category];
}

/** Find a shortcut definition by its id (compile-time checked) */
export function getShortcutById(id: ShortcutId): ShortcutDefinition {
  const def = SHORTCUTS.find((s) => s.id === id);
  // This should never happen at runtime since ShortcutId is a closed union,
  // but satisfies the type checker.
  if (!def) throw new Error(`Unknown shortcut id: ${id}`);
  return def;
}
