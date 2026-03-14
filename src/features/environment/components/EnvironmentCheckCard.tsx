import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useSystemCheck } from "../hooks/useSystemCheck";

interface CheckItem {
  label: string;
  installed: boolean;
  version: string | null;
  installCmd: string;
}

function CheckRow({ item }: { item: CheckItem }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="flex items-center gap-2 min-w-0">
        {item.installed ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        )}
        <span className="text-xs text-text-secondary truncate">
          {item.label}
        </span>
      </div>
      <span className="text-[11px] font-mono text-text-muted shrink-0">
        {item.installed ? (item.version ?? "") : item.installCmd}
      </span>
    </div>
  );
}

export function EnvironmentCheckCard() {
  const { env, isLoading, error } = useSystemCheck();

  if (isLoading) {
    return (
      <div className="glass-surface rounded-xl p-5 max-w-sm w-full flex items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
        <span className="text-xs text-text-muted">
          Checking environment...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-surface rounded-xl p-5 max-w-sm w-full">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span className="text-xs text-text-secondary">{error}</span>
        </div>
      </div>
    );
  }

  if (!env) return null;

  const requiredItems: CheckItem[] = [
    {
      label: "tmux",
      installed: env.tmuxInstalled,
      version: env.tmuxVersion,
      installCmd: "brew install tmux",
    },
    {
      label: "git",
      installed: env.gitInstalled,
      version: env.gitVersion,
      installCmd: "brew install git",
    },
  ];

  const agentItems: CheckItem[] = [
    {
      label: "Claude Code",
      installed: env.claudeCodeInstalled,
      version: env.claudeCodeVersion,
      installCmd: "npm i -g @anthropic-ai/claude-code",
    },
    {
      label: "Codex CLI",
      installed: env.codexCliInstalled,
      version: env.codexCliVersion,
      installCmd: "npm i -g @openai/codex",
    },
    {
      label: "Gemini CLI",
      installed: env.geminiCliInstalled,
      version: env.geminiCliVersion,
      installCmd: "npm i -g @google/gemini-cli",
    },
  ];

  const allItems = [...requiredItems, ...agentItems];
  const allInstalled = allItems.every((item) => item.installed);

  return (
    <div className="glass-surface rounded-xl p-5 max-w-sm w-full">
      {/* Required section */}
      <div className="mb-3">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-muted mb-1.5">
          Required
        </h3>
        <div className="flex flex-col">
          {requiredItems.map((item) => (
            <CheckRow key={item.label} item={item} />
          ))}
        </div>
      </div>

      {/* AI Agents section */}
      <div>
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-muted mb-1.5">
          AI Agents
        </h3>
        <div className="flex flex-col">
          {agentItems.map((item) => (
            <CheckRow key={item.label} item={item} />
          ))}
        </div>
      </div>

      {/* All checks passed footer */}
      {allInstalled && (
        <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 text-emerald-400/70" />
          <span className="text-[11px] text-text-muted">
            All checks passed
          </span>
        </div>
      )}
    </div>
  );
}
