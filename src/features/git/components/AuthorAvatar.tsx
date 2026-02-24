import { memo } from "react";
import { Sparkles } from "lucide-react";

/** Fixed purple for AI agent avatars, matching existing AI badge theme */
const AGENT_COLOR = "oklch(0.55 0.2 290)";

/** Module-level cache: same author name always maps to same color */
const colorCache = new Map<string, string>();

/**
 * Deterministic oklch color from author name using djb2 hash.
 * Uses lower chroma (0.1) than branch colors (0.15) to avoid visual collision.
 * Results are cached since the same author appears across many commits.
 */
export function authorColor(name: string): string {
  const cached = colorCache.get(name);
  if (cached) return cached;

  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 33) ^ name.charCodeAt(i);
  }
  const hue = Math.abs(hash) % 360;
  const color = `oklch(0.72 0.1 ${hue})`;
  colorCache.set(name, color);
  return color;
}

interface AuthorAvatarProps {
  name: string;
  isAgent: boolean;
}

export const AuthorAvatar = memo(function AuthorAvatar({ name, isAgent }: AuthorAvatarProps) {
  const bg = isAgent ? AGENT_COLOR : authorColor(name);
  const initial = name.charAt(0).toUpperCase();

  return (
    <span
      className={`shrink-0 inline-flex items-center justify-center rounded-full
        border border-white/[0.08] text-[10px] font-bold leading-none text-white
        ${isAgent ? "shadow-[0_0_4px_oklch(0.6_0.2_290/0.15)]" : ""}`}
      style={{
        width: 20,
        height: 20,
        backgroundColor: bg,
      }}
      title={name}
      aria-label={isAgent ? `AI Agent: ${name}` : `Author: ${name}`}
    >
      {isAgent ? (
        <Sparkles className="h-2.5 w-2.5" />
      ) : (
        initial
      )}
    </span>
  );
});
