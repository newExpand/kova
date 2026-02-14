import { useEffect } from "react";
import { Settings } from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import type { NotificationStyle } from "../types";
import { cn } from "../../../lib/utils";

// ---------------------------------------------------------------------------
// Radio Option
// ---------------------------------------------------------------------------

interface RadioOptionProps {
  value: NotificationStyle;
  current: NotificationStyle;
  label: string;
  description: string;
  onChange: (value: NotificationStyle) => void;
  disabled: boolean;
}

function RadioOption({
  value,
  current,
  label,
  description,
  onChange,
  disabled,
}: RadioOptionProps) {
  const isSelected = current === value;

  return (
    <button
      type="button"
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4 text-left transition-colors",
        isSelected
          ? "border-primary bg-primary/[0.06]"
          : "border-white/[0.10] glass-surface glass-hover-lift",
        disabled && "pointer-events-none opacity-50",
      )}
      onClick={() => onChange(value)}
      disabled={disabled}
      aria-pressed={isSelected}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
          isSelected ? "border-primary" : "border-text-muted",
        )}
      >
        {isSelected && (
          <span className="h-2 w-2 rounded-full bg-primary" />
        )}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{label}</p>
        <p className="mt-0.5 text-xs text-text-muted">{description}</p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------

function SettingsPage() {
  const notificationStyle = useSettingsStore((s) => s.notificationStyle);
  const isLoading = useSettingsStore((s) => s.isLoading);
  const error = useSettingsStore((s) => s.error);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const setNotificationStyle = useSettingsStore((s) => s.setNotificationStyle);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/[0.08] glass-toolbar px-6 py-4">
        <Settings className="h-5 w-5 text-text-muted" strokeWidth={1.5} />
        <div>
          <h1 className="text-lg font-semibold text-text">Settings</h1>
          <p className="text-xs text-text-muted">
            Configure application preferences
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-lg space-y-8">
          {/* Notification Style Section */}
          <section>
            <h2 className="mb-1 text-sm font-semibold text-text">
              Notification Style
            </h2>
            <p className="mb-4 text-xs text-text-muted">
              Choose how hook notifications appear on your desktop
            </p>

            <div className="space-y-2">
              <RadioOption
                value="alert"
                current={notificationStyle}
                label="Alert (persistent)"
                description="Stays on screen until you dismiss it. Requires alerter to be installed."
                onChange={setNotificationStyle}
                disabled={isLoading}
              />
              <RadioOption
                value="banner"
                current={notificationStyle}
                label="Banner (temporary)"
                description="Disappears automatically after a few seconds. Uses macOS native notification."
                onChange={setNotificationStyle}
                disabled={isLoading}
              />
            </div>
          </section>

          {error && (
            <p className="text-xs text-danger">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
export { SettingsPage };
