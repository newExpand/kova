import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useProjectStore } from "../../project/stores/projectStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useTmuxSessions } from "../../tmux/hooks/useTmuxSessions";
import { TerminalView } from "./TerminalView";
import { PaneToolbar } from "./PaneToolbar";
import { WindowToolbar } from "./WindowToolbar";
import { NewPaneDialog } from "./NewPaneDialog";
import { ThemePickerPanel } from "./ThemePickerPanel";
import { Button } from "../../../components/ui/button";
import {
  splitTmuxPaneVertical,
  splitTmuxPaneHorizontal,
  createTmuxWindow,
  sendTmuxKeys,
} from "../../../lib/tauri/commands";
import type { TerminalConfig, PaneAction } from "../types";

function TerminalPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const project = useProjectStore((s) =>
    s.projects.find((p) => p.id === projectId),
  );

  const status = useTerminalStore((s) => s.status);

  // Clean up terminal store when leaving terminal route (e.g. /sessions, /settings)
  useEffect(() => {
    console.warn(`[TERM-DEBUG] TerminalPage MOUNT projectId=${projectId}`);
    return () => {
      console.warn(`[TERM-DEBUG] TerminalPage UNMOUNT projectId=${projectId} status=${useTerminalStore.getState().status}`);
      useTerminalStore.getState().reset();
    };
  }, [projectId]);


  const { sessions, projectSessions, isAvailable, isLoading, hasFetchedSessions } =
    useTmuxSessions(projectId);

  const [activeConfig, setActiveConfig] = useState<TerminalConfig | null>(null);
  const autoConnectAttempted = useRef(false);
  const [autoConnectDone, setAutoConnectDone] = useState(false);
  const [pendingAction, setPendingAction] = useState<PaneAction | null>(null);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);

  const handleConnect = useCallback(
    (config: TerminalConfig) => {
      setActiveConfig({ ...config, projectId: projectId ?? "" });
    },
    [projectId],
  );

  // Auto-connect: attach existing session or create new one
  useEffect(() => {
    if (autoConnectAttempted.current) return;
    if (isAvailable === null || isLoading || !hasFetchedSessions) {
      console.warn(`[TERM-DEBUG] TerminalPage auto-connect WAITING projectId=${projectId} isAvailable=${isAvailable} isLoading=${isLoading} hasFetched=${hasFetchedSessions}`);
      return;
    }
    if (activeConfig) return;

    if (isAvailable === false) {
      // tmux not installed
      autoConnectAttempted.current = true;
      setAutoConnectDone(true);
      return;
    }

    autoConnectAttempted.current = true;
    setAutoConnectDone(true);

    const slug =
      project?.name.toLowerCase().replace(/\s+/g, "-") ?? "default";
    const firstSession = projectSessions[0];
    const name = firstSession ? firstSession.name : slug;

    // Check if session already exists in tmux (even if not registered in app DB)
    const existsInTmux = sessions.some((s) => s.name === name);
    const isNewSession = !firstSession && !existsInTmux;

    console.warn(`[TERM-DEBUG] TerminalPage auto-connect FIRE projectId=${projectId} session=${name} isNew=${isNewSession}`);
    handleConnect({
      projectId: projectId ?? "",
      sessionName: name,
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

  const handleRetry = useCallback(() => {
    autoConnectAttempted.current = false;
    setAutoConnectDone(false);
    setActiveConfig(null);
    useTerminalStore.getState().setStatus("idle");
  }, []);

  const refocusTerminal = useCallback(() => {
    requestAnimationFrame(() => {
      const textarea = terminalContainerRef.current?.querySelector(
        ".xterm textarea",
      ) as HTMLTextAreaElement | null;
      textarea?.focus();
    });
  }, []);

  const handleToggleThemePicker = useCallback(() => {
    setThemePickerOpen((prev) => !prev);
  }, []);

  const handleCloseThemePicker = useCallback(() => {
    setThemePickerOpen(false);
  }, []);

  const handleRequestAction = useCallback((action: PaneAction) => {
    setPendingAction(action);
  }, []);

  const handleConfirmAction = useCallback(
    (startClaude: boolean) => {
      const action = pendingAction;
      const sessionName = activeConfig?.sessionName;
      setPendingAction(null);

      if (!action || !sessionName) return;

      const executeAction = async () => {
        switch (action) {
          case "split-vertical":
            await splitTmuxPaneVertical(sessionName);
            break;
          case "split-horizontal":
            await splitTmuxPaneHorizontal(sessionName);
            break;
          case "new-window":
            await createTmuxWindow(sessionName);
            break;
        }
        if (startClaude) {
          // Wait for shell to initialize in the new pane/window
          await new Promise((resolve) => setTimeout(resolve, 300));
          await sendTmuxKeys(sessionName, "claude --dangerously-skip-permissions");
        }
      };

      executeAction().catch((e) =>
        console.error(`Action ${action} failed:`, e),
      );

      refocusTerminal();
    },
    [pendingAction, activeConfig?.sessionName, refocusTerminal],
  );

  const handleCancelAction = useCallback(() => {
    setPendingAction(null);
    refocusTerminal();
  }, [refocusTerminal]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-muted">Project not found</p>
      </div>
    );
  }

  // Rendering state decisions (priority order)
  const showLoading = !autoConnectDone && status !== "error";
  const showTmuxMissing = autoConnectDone && isAvailable === false;
  const showError = status === "error";
  const showTerminal = activeConfig && !showError;

  return (
    <div className="flex h-full flex-1 min-w-0 flex-col overflow-hidden">
      {showLoading && !showTerminal ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
            <p className="text-sm text-text-muted">Connecting...</p>
          </div>
        </div>
      ) : showTmuxMissing ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="glass-surface rounded-xl p-6 text-center">
            <p className="text-sm text-text">tmux is not installed</p>
            <p className="mt-2 text-xs text-text-muted">
              Install with:{" "}
              <code className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono">
                brew install tmux
              </code>
            </p>
          </div>
        </div>
      ) : showError ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="glass-surface rounded-xl border border-danger/30 p-4 text-center">
            <p className="text-sm text-danger">Connection failed</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={handleRetry}
            >
              Retry
            </Button>
          </div>
        </div>
      ) : showTerminal ? (
        <div
          ref={terminalContainerRef}
          style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <WindowToolbar
            sessionName={activeConfig.sessionName}
            disabled={status !== "connected"}
            onRequestAction={handleRequestAction}
          />
          <PaneToolbar
            sessionName={activeConfig.sessionName}
            disabled={status !== "connected"}
            onRequestAction={handleRequestAction}
            onToggleThemePicker={handleToggleThemePicker}
          />
          <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
            <TerminalView
              key={activeConfig.sessionName}
              config={activeConfig}
              glassClassName="terminal-glass"
              onRequestPaneAction={handleRequestAction}
            />
            <ThemePickerPanel
              open={themePickerOpen}
              onClose={handleCloseThemePicker}
            />
          </div>
        </div>
      ) : null}
      <NewPaneDialog
        action={pendingAction}
        onConfirm={handleConfirmAction}
        onCancel={handleCancelAction}
      />
    </div>
  );
}

export default TerminalPage;
export { TerminalPage };
