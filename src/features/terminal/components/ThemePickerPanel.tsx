import { useRef, useEffect, useCallback, memo, useState } from "react";
// Direct import to avoid circular chunk dependency (terminal ↔ settings)
import { useSettingsStore } from "../../settings/stores/settingsStore";
import { THEME_GROUPS, getSwatchColors } from "../themes";
import { FONT_GROUPS, FONT_SIZE_MIN, FONT_SIZE_MAX, isFontAvailable, loadFontCss } from "../fonts";
import { cn } from "../../../lib/utils";
import type { TerminalTheme } from "../themes/types";
import type { FontPreset } from "../fonts";

interface ThemePickerPanelProps {
  open: boolean;
  onClose: () => void;
}

export const ThemePickerPanel = memo(function ThemePickerPanel({
  open,
  onClose,
}: ThemePickerPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const terminalTheme = useSettingsStore((s) => s.terminalTheme);
  const setTerminalTheme = useSettingsStore((s) => s.setTerminalTheme);
  const opacity = useSettingsStore((s) => s.terminalOpacity);
  const setOpacity = useSettingsStore((s) => s.setTerminalOpacity);
  const fontFamily = useSettingsStore((s) => s.terminalFontFamily);
  const setFontFamily = useSettingsStore((s) => s.setTerminalFontFamily);
  const fontSize = useSettingsStore((s) => s.terminalFontSize);
  const setFontSize = useSettingsStore((s) => s.setTerminalFontSize);

  const handleOpacityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setOpacity(parseFloat(e.target.value));
    },
    [setOpacity],
  );

  const handleFontSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFontSize(parseInt(e.target.value, 10));
    },
    [setFontSize],
  );

  // Dismiss on click-outside or Escape
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="absolute right-2 top-2 z-20 w-64 rounded-xl border border-white/[0.15] glass-elevated glass-specular"
    >
      <div className="p-2">
        {/* ── Font Family ── */}
        <p className="mb-1 px-1 text-xs font-semibold text-text-muted">
          Font
        </p>
        <div className="mb-2 max-h-40 space-y-1.5 overflow-y-auto">
          {FONT_GROUPS.map(({ group, fonts }) => (
            <div key={group}>
              <p className="px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                {group}
              </p>
              <div className="space-y-px">
                {fonts.map((font) => (
                  <CompactFontItem
                    key={font.id}
                    font={font}
                    isSelected={fontFamily === font.id}
                    onClick={() => setFontFamily(font.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Font Size Slider ── */}
        <div className="mb-2 px-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-muted">Font Size</span>
            <span className="text-[10px] tabular-nums text-text-secondary">
              {fontSize}px
            </span>
          </div>
          <input
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step="1"
            value={fontSize}
            onChange={handleFontSizeChange}
            className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-white/[0.12] accent-primary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm"
          />
        </div>

        {/* ── Opacity Slider ── */}
        <div className="mb-2 px-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-muted">Terminal Opacity</span>
            <span className="text-[10px] tabular-nums text-text-secondary">
              {Math.round(opacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0.5"
            max="1.0"
            step="0.05"
            value={opacity}
            onChange={handleOpacityChange}
            className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-white/[0.12] accent-primary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm"
          />
        </div>

        {/* ── Theme List ── */}
        <p className="mb-2 px-1 text-xs font-semibold text-text-muted">
          Terminal Theme
        </p>
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {THEME_GROUPS.map(({ group, themes }) => (
            <div key={group}>
              <p className="px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                {group}
              </p>
              <div className="space-y-px">
                {themes.map((theme) => (
                  <CompactThemeItem
                    key={theme.id}
                    theme={theme}
                    isSelected={terminalTheme === theme.id}
                    onClick={() => setTerminalTheme(theme.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// ── Font Item ──

interface CompactFontItemProps {
  font: FontPreset;
  isSelected: boolean;
  onClick: () => void;
}

function CompactFontItem({
  font,
  isSelected,
  onClick,
}: CompactFontItemProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // For popular fonts, preload the bundled fontsource CSS in background
      if (font.category === "popular") {
        const ok = await loadFontCss(font);
        if (!cancelled) setAvailable(ok);
      } else {
        // System fonts — check local availability
        await document.fonts.ready;
        if (!cancelled) setAvailable(isFontAvailable(font.fontFamily));
      }
    })();
    return () => { cancelled = true; };
  }, [font]);

  const handleClick = useCallback(async () => {
    if (available) {
      onClick();
      return;
    }
    // Font not yet loaded — try loading now
    setLoading(true);
    const ok = await loadFontCss(font);
    setLoading(false);
    setAvailable(ok);
    if (ok) onClick();
  }, [available, font, onClick]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors",
        isSelected
          ? "bg-primary/[0.12] text-text"
          : "text-text hover:bg-white/[0.08]",
      )}
      aria-pressed={isSelected}
    >
      <span
        className="shrink-0 text-[11px]"
        style={{ fontFamily: font.fontFamily }}
      >
        Abc
      </span>
      <span className="truncate text-xs">
        {font.name}
      </span>
      {loading && (
        <span className="ml-auto shrink-0 text-[9px] text-text-secondary animate-pulse">
          loading...
        </span>
      )}
      {isSelected && !loading && (
        <span className="ml-auto shrink-0 text-xs text-primary">&#x2713;</span>
      )}
    </button>
  );
}

// ── Theme Item ──

interface CompactThemeItemProps {
  theme: TerminalTheme;
  isSelected: boolean;
  onClick: () => void;
}

function CompactThemeItem({
  theme,
  isSelected,
  onClick,
}: CompactThemeItemProps) {
  const swatchColors = getSwatchColors(theme);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors",
        isSelected
          ? "bg-primary/[0.12] text-text"
          : "text-text hover:bg-white/[0.08]",
      )}
      aria-pressed={isSelected}
    >
      <div className="flex shrink-0 gap-0.5">
        {swatchColors.map((color, i) => (
          <span
            key={i}
            className="h-3 w-3 rounded-sm border border-border-subtle"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      <span className="truncate text-xs">{theme.name}</span>
      {isSelected && (
        <span className="ml-auto shrink-0 text-xs text-primary">&#x2713;</span>
      )}
    </button>
  );
}
