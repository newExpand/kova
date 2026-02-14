import { useRef, useEffect, useCallback, memo } from "react";
// Direct import to avoid circular chunk dependency (terminal ↔ settings)
import { useSettingsStore } from "../../settings/stores/settingsStore";
import { THEME_GROUPS, getSwatchColors } from "../themes";
import { cn } from "../../../lib/utils";
import type { TerminalTheme } from "../themes/types";
import type { GlassMode } from "../../settings/types";

const GLASS_OPTIONS: { value: GlassMode; label: string }[] = [
  { value: "opaque", label: "Opaque" },
  { value: "faux", label: "Glass" },
];

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
  const glassMode = useSettingsStore((s) => s.terminalGlassMode);
  const setGlassMode = useSettingsStore((s) => s.setTerminalGlassMode);
  const opacity = useSettingsStore((s) => s.terminalOpacity);
  const setOpacity = useSettingsStore((s) => s.setTerminalOpacity);

  const handleOpacityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setOpacity(parseFloat(e.target.value));
    },
    [setOpacity],
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
      className="absolute right-2 top-2 z-20 w-56 rounded-xl border border-white/[0.15] glass-elevated glass-specular"
    >
      <div className="p-2">
        {/* ── Glass Mode Selector ── */}
        <p className="mb-1.5 px-1 text-xs font-semibold text-text-muted">
          Background
        </p>
        <div className="mb-2 flex rounded-lg bg-white/[0.06] p-0.5">
          {GLASS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setGlassMode(opt.value)}
              className={cn(
                "flex-1 rounded-md px-1 py-1 text-[10px] font-medium transition-colors",
                glassMode === opt.value
                  ? "bg-white/[0.15] text-text shadow-sm"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* ── Opacity Slider (visible when glass/vibrancy) ── */}
        {glassMode !== "opaque" && (
          <div className="mb-2 px-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted">Opacity</span>
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
        )}

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
