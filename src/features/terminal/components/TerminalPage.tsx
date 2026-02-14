import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useProjectStore } from "../../project/stores/projectStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useTmuxSessions } from "../../tmux/hooks/useTmuxSessions";
import { SessionSelector } from "./SessionSelector";
import { TerminalView } from "./TerminalView";
import { PaneToolbar } from "./PaneToolbar";
import { WindowToolbar } from "./WindowToolbar";
import type { TerminalConfig } from "../types";

function TerminalPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const project = useProjectStore((s) =>
    s.projects.find((p) => p.id === projectId),
  );

  const status = useTerminalStore((s) => s.status);

  const { sessions, projectSessions, isAvailable, isLoading, hasFetchedSessions } =
    useTmuxSessions(projectId);

  const [activeConfig, setActiveConfig] = useState<TerminalConfig | null>(null);
  const autoConnectAttempted = useRef(false);

  const handleConnect = useCallback(
    (config: TerminalConfig) => {
      setActiveConfig({ ...config, projectId: projectId ?? "" });
    },
    [projectId],
  );

  // Auto-connect: attach existing session or create new one
  useEffect(() => {
    if (autoConnectAttempted.current) return;
    if (isAvailable === null || isLoading || !hasFetchedSessions) return;
    if (activeConfig) return;

    if (isAvailable === false) {
      // tmux not installed — fall through to SessionSelector (shows error)
      autoConnectAttempted.current = true;
      return;
    }

    autoConnectAttempted.current = true;

    const slug =
      project?.name.toLowerCase().replace(/\s+/g, "-") ?? "default";
    const firstSession = projectSessions[0];
    const name = firstSession ? firstSession.name : slug;

    // Check if session already exists in tmux (even if not registered in app DB)
    const existsInTmux = sessions.some((s) => s.name === name);
    const isNewSession = !firstSession && !existsInTmux;

    handleConnect({
      projectId: projectId ?? "",
      sessionName: name,
      mode: "new", // tmux -A handles attach-or-create
      cols: 80,
      rows: 24,
      cwd: project?.path,
      initialCommand: isNewSession
        ? "claude --dangerously-skip-permissions"
        : undefined,
    });
  }, [
    isAvailable,
    isLoading,
    hasFetchedSessions,
    projectSessions.length,
    activeConfig,
    project?.name,
    projectId,
    handleConnect,
    projectSessions,
    sessions,
  ]);

  // On error, allow fallback to manual SessionSelector
  const showFallback = !activeConfig || status === "error";

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-muted">Project not found</p>
      </div>
    );
  }

  const isConnecting = status === "connecting";

  return (
    <div className="flex h-full flex-1 min-w-0 flex-col overflow-hidden">
      {isConnecting && !activeConfig ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-text-muted">Connecting...</p>
        </div>
      ) : showFallback ? (
        <div className="flex-1 overflow-y-auto p-6">
          {status === "error" && (
            <div className="mb-4 rounded-lg border border-danger bg-bg-secondary p-3">
              <p className="text-sm text-danger">
                Connection failed. Please select a session manually.
              </p>
            </div>
          )}
          <SessionSelector
            projectName={project.name}
            onConnect={handleConnect}
            disabled={isConnecting}
          />
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <WindowToolbar
            sessionName={activeConfig.sessionName}
            disabled={status !== "connected"}
          />
          <PaneToolbar
            sessionName={activeConfig.sessionName}
            disabled={status !== "connected"}
          />
          <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
            <TerminalView config={activeConfig} />
          </div>
        </div>
      )}
    </div>
  );
}

export default TerminalPage;
export { TerminalPage };
