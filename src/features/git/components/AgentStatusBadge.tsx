import type { AgentStatus } from "../stores/agentActivityStore";
import { Check, AlertTriangle, Zap, Pencil, GitCommit } from "lucide-react";

interface AgentStatusBadgeProps {
  status: AgentStatus;
  lastMessage?: string | null;
  toolUseCount?: number;
  fileEditCount?: number;
  commitCount?: number;
  errorCount?: number;
  isWaitingForInput?: boolean;
}

export function AgentStatusBadge({
  status,
  lastMessage,
  toolUseCount,
  fileEditCount,
  commitCount,
  errorCount,
  isWaitingForInput,
}: AgentStatusBadgeProps) {
  return (
    <div className="flex flex-col gap-1">
      {/* Status line: dot + action description */}
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusDot status={status} isWaiting={isWaitingForInput} />
        <span className="text-[11px] text-text-muted truncate">
          {isWaitingForInput && "Waiting..."}
          {!isWaitingForInput && status === "loading" && "Thinking..."}
          {!isWaitingForInput && status === "active" && (lastMessage ?? "Working...")}
          {!isWaitingForInput && status === "ready" && (lastMessage ?? "Ready")}
          {status === "idle" && "Idle"}
          {status === "done" && "Done"}
          {status === "error" && "Error"}
        </span>
      </div>
      {/* Counts line: icons + numbers */}
      {(toolUseCount ?? 0) > 0 && (
        <div className="flex items-center gap-1 pl-3.5 flex-wrap">
          <span className="flex items-center gap-0.5 text-[10px] text-text-muted" title="Tool uses">
            <Zap className="h-2.5 w-2.5" />
            {toolUseCount}
          </span>
          {(fileEditCount ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-text-muted" title="File edits">
              <Pencil className="h-2.5 w-2.5" />
              {fileEditCount}
            </span>
          )}
          {(commitCount ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-text-muted" title="Commits">
              <GitCommit className="h-2.5 w-2.5" />
              {commitCount}
            </span>
          )}
          {(errorCount ?? 0) > 0 && (
            <>
              <span className="text-[10px] text-text-muted/30">│</span>
              <span className="flex items-center gap-0.5 text-[10px] text-danger font-medium" title="Errors">
                <AlertTriangle className="h-2.5 w-2.5" />
                {errorCount} err
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function StatusDot({
  status,
  isWaiting,
}: {
  status: AgentStatus;
  isWaiting?: boolean;
}) {
  // Waiting for input — amber pulse
  if (isWaiting) {
    return (
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-warning" />
      </span>
    );
  }

  if (status === "loading") {
    return (
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
    );
  }

  if (status === "ready") {
    return <span className="h-2 w-2 rounded-full bg-success" />;
  }

  if (status === "active") {
    return (
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
    );
  }

  if (status === "done") {
    return <Check className="h-3 w-3 text-success" strokeWidth={3} />;
  }

  if (status === "error") {
    return <span className="h-2 w-2 rounded-full bg-danger" />;
  }

  // idle
  return <span className="h-2 w-2 rounded-full bg-text-muted/50" />;
}
