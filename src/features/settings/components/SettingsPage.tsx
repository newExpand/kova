import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import { AGENT_TYPES, type AgentType } from "../../../lib/tauri/commands";
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
// Agent Command Row
// ---------------------------------------------------------------------------

interface AgentCommandRowProps {
  agentType: AgentType;
  label: string;
  command: string;
  defaultCommand: string;
  onSave: (agentType: AgentType, command: string) => Promise<void>;
  disabled: boolean;
}

function AgentCommandRow({
  agentType,
  label,
  command,
  defaultCommand,
  onSave,
  disabled,
}: AgentCommandRowProps) {
  const [localValue, setLocalValue] = useState(command);
  const isCustom = command !== defaultCommand;

  useEffect(() => {
    setLocalValue(command);
  }, [command]);

  const handleBlur = () => {
    if (disabled) return;
    const trimmed = localValue.trim();
    if (!trimmed) {
      setLocalValue(defaultCommand);
      void onSave(agentType, "");
      return;
    }
    if (trimmed !== command) {
      void onSave(agentType, trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-text">{label}</label>
        {isCustom && (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => void onSave(agentType, defaultCommand)}
            disabled={disabled}
          >
            Reset
          </button>
        )}
      </div>
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={defaultCommand}
        disabled={disabled}
        className={cn(
          "w-full rounded-md border px-3 py-2 text-sm font-mono",
          "border-white/[0.10] bg-white/[0.04] text-text placeholder:text-text-muted/50",
          "focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30",
          disabled && "opacity-50 pointer-events-none",
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------

function SettingsPage() {
  const notificationStyle = useSettingsStore((s) => s.notificationStyle);
  const agentCommands = useSettingsStore((s) => s.agentCommands);
  const isLoading = useSettingsStore((s) => s.isLoading);
  const error = useSettingsStore((s) => s.error);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const setNotificationStyle = useSettingsStore((s) => s.setNotificationStyle);
  const setAgentCommand = useSettingsStore((s) => s.setAgentCommand);
  const alerterInstalled = useSettingsStore((s) => s.alerterInstalled);

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
                description={alerterInstalled === false
                  ? "Requires: brew install alerter"
                  : "Stays on screen until you dismiss it."}
                onChange={setNotificationStyle}
                disabled={isLoading || alerterInstalled === null || alerterInstalled === false}
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

          {/* Agent Commands Section */}
          <section>
            <h2 className="mb-1 text-sm font-semibold text-text">
              Agent Commands
            </h2>
            <p className="mb-4 text-xs text-text-muted">
              Customize the CLI command used to launch each agent
            </p>

            <div className="space-y-4">
              {(Object.keys(AGENT_TYPES) as AgentType[]).map((agentType) => (
                <AgentCommandRow
                  key={agentType}
                  agentType={agentType}
                  label={AGENT_TYPES[agentType].label}
                  command={agentCommands[agentType].command}
                  defaultCommand={agentCommands[agentType].defaultCommand}
                  onSave={setAgentCommand}
                  disabled={isLoading}
                />
              ))}
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
