import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useProjectStore } from "../../project/stores/projectStore";
import { useSshStore } from "../../ssh";
import { useTerminalStore } from "../stores/terminalStore";
import { useTmuxSessions } from "../../tmux/hooks/useTmuxSessions";
import { TerminalView } from "./TerminalView";
import { PaneToolbar } from "./PaneToolbar";
import { WindowToolbar } from "./WindowToolbar";
import { NewPaneDialog } from "./NewPaneDialog";
import { ThemePickerPanel } from "./ThemePickerPanel";
import { Button } from "../../../components/ui/button";
import { DEFAULT_AGENT_TYPE, type AgentType } from "../../../lib/tauri/commands";
// Direct import to avoid circular chunk warning (settings ↔ terminal barrel cycle)
import { useSettingsStore } from "../../settings/stores/settingsStore";
import {
  splitTmuxPaneVertical,
  splitTmuxPaneHorizontal,
  createTmuxWindow,
  sendTmuxKeys,
  startWorktreeTask,
  restoreWorktreeWindows,
  startSessionMonitoring,
  checkSshRemoteTmux,
  remoteTmuxSplitPaneVertical,
  remoteTmuxSplitPaneHorizontal,
  remoteTmuxCreateWindow,
  remoteTmuxClosePane,
  remoteTmuxCloseWindow,
  remoteTmuxNextWindow,
  remoteTmuxPreviousWindow,
  remoteTmuxSendKeys,
} from "../../../lib/tauri/commands";
import type { TerminalConfig, PaneAction } from "../types";

type TmuxCheckStatus = "pending" | "available" | "unavailable" | "indeterminate";

interface TerminalPageProps {
  projectId?: string;
  sshConnectionId?: string;
  isActive: boolean;
}

function TerminalPage({ projectId, sshConnectionId, isActive }: TerminalPageProps) {
  // Determine mode
  const isSshMode = !!sshConnectionId;
  const storeKey = isSshMode ? `ssh-${sshConnectionId}` : projectId!;

  const project = useProjectStore((s) =>
    projectId ? s.projects.find((p) => p.id === projectId) : undefined,
  );

  const sshActiveResult = useSshStore((s) =>
    sshConnectionId ? s.getActiveResult(sshConnectionId) : undefined,
  );
  const sshConnection = useSshStore((s) =>
    sshConnectionId ? s.getConnectionById(sshConnectionId) : undefined,
  );

  const status = useTerminalStore((s) => s.getTerminal(storeKey).status);
  const errorMessage = useTerminalStore((s) => s.getTerminal(storeKey).error);
  const agentCommandsRef = useRef(useSettingsStore.getState().agentCommands);
  useEffect(() => {
    return useSettingsStore.subscribe((s) => {
      agentCommandsRef.current = s.agentCommands;
    });
  }, []);

  // Clean up this terminal's state on unmount
  useEffect(() => {
    return () => {
      useTerminalStore.getState().resetTerminal(storeKey);
    };
  }, [storeKey]);

  // Project mode: use tmux sessions hook
  const { sessions, projectSessions, isAvailable, isLoading, hasFetchedSessions } =
    useTmuxSessions(isSshMode ? undefined : projectId);

  const [activeConfig, setActiveConfig] = useState<TerminalConfig | null>(null);
  const autoConnectAttempted = useRef(false);
  const [autoConnectDone, setAutoConnectDone] = useState(false);
  const [sshTmuxStatus, setSshTmuxStatus] = useState<TmuxCheckStatus>("pending");
  const tmuxReconnectAttempted = useRef(false);
  const [pendingAction, setPendingAction] = useState<PaneAction | null>(null);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);

  const handleConnect = useCallback(
    (config: TerminalConfig) => {
      setActiveConfig({ ...config, projectId: storeKey });
    },
    [storeKey],
  );

  // SSH mode: auto-connect using sshActiveResult (immediate plain SSH + background tmux check)
  useEffect(() => {
    if (!isSshMode || autoConnectAttempted.current || !sshActiveResult) return;

    // Store has cached check result from previous navigation → reuse it
    if (sshActiveResult.remoteTmuxAvailable === false) {
      autoConnectAttempted.current = true;
      setAutoConnectDone(true);
      setSshTmuxStatus("unavailable");
      return; // show tmux-not-installed UI
    }
    if (sshActiveResult.remoteTmuxAvailable === true) {
      autoConnectAttempted.current = true;
      setAutoConnectDone(true);
      setSshTmuxStatus("available");
      // Already known → connect with tmux args (includes full config from Rust)
      const sshArgs = [...(sshActiveResult.sshArgs ?? [])];
      sshArgs.push("-t", sshActiveResult.remoteTmuxCommand!);
      handleConnect({
        projectId: storeKey,
        sessionName: `ssh-${sshActiveResult.connectionId}-tmux`,
        cols: 80,
        rows: 24,
        sshArgs,
        isSshMode: true,
        sshConnectionId: sshActiveResult.connectionId,
        remoteTmuxSessionName: sshActiveResult.remoteSessionName ?? undefined,
      });
      return;
    }

    // remoteTmuxAvailable === null → first connection: plain SSH immediately + background check
    autoConnectAttempted.current = true;
    setAutoConnectDone(true);

    handleConnect({
      projectId: storeKey,
      sessionName: `ssh-${sshActiveResult.connectionId}`,
      cols: 80,
      rows: 24,
      sshArgs: [...(sshActiveResult.sshArgs ?? [])],
      isSshMode: true,
      sshConnectionId: sshActiveResult.connectionId,
    });

    // Background tmux check
    if (sshActiveResult.remoteSessionName && sshConnectionId) {
      checkSshRemoteTmux(sshConnectionId)
        .then((result) => {
          const newStatus: TmuxCheckStatus =
            result === true ? "available" :
            result === false ? "unavailable" : "indeterminate";
          setSshTmuxStatus(newStatus);
          // Persist in store for navigation cache
          useSshStore.getState().updateRemoteTmuxAvailable(sshConnectionId!, result);
        })
        .catch((e) => {
          console.warn("[SSH] Remote tmux check failed:", e);
          setSshTmuxStatus("indeterminate");
        });
    }
  }, [isSshMode, sshActiveResult, handleConnect, storeKey, sshConnectionId, autoConnectDone]);

  // SSH mode: reconnect with tmux when background check confirms availability
  useEffect(() => {
    if (!isSshMode || !sshActiveResult?.remoteSessionName) return;
    if (sshTmuxStatus !== "available") return;
    if (tmuxReconnectAttempted.current) return; // prevent infinite loop
    tmuxReconnectAttempted.current = true;

    // Set "connecting" to prevent "disconnected" flash during remount
    useTerminalStore.getState().setStatus(storeKey, "connecting");

    // Invalidate old PTY pid (orphan prevention)
    if (sshConnectionId) {
      const oldPid = useSshStore.getState().sshPtyPids[sshConnectionId];
      if (oldPid != null) {
        useSshStore.getState().registerSshPtyPid(sshConnectionId, -1);
      }
    }

    const sshArgs = [...(sshActiveResult.sshArgs ?? [])];
    sshArgs.push("-t", sshActiveResult.remoteTmuxCommand!);

    // sessionName with '-tmux' suffix → React key change → TerminalView remount
    handleConnect({
      projectId: storeKey,
      sessionName: `ssh-${sshActiveResult.connectionId}-tmux`,
      cols: 80,
      rows: 24,
      sshArgs,
      isSshMode: true,
      sshConnectionId: sshActiveResult.connectionId,
      remoteTmuxSessionName: sshActiveResult.remoteSessionName ?? undefined,
    });
  }, [sshTmuxStatus, isSshMode, sshActiveResult, handleConnect, storeKey, sshConnectionId]);

  // SSH mode: timeout when sshActiveResult is missing (e.g. page refresh)
  useEffect(() => {
    if (!isSshMode) return;
    if (autoConnectAttempted.current) return;
    if (sshActiveResult) return;

    const timer = setTimeout(() => {
      if (!autoConnectAttempted.current) {
        autoConnectAttempted.current = true;
        setAutoConnectDone(true);
        useTerminalStore.getState().setError(
          storeKey,
          "SSH session is not active. Please reconnect from the sidebar.",
        );
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [isSshMode, sshActiveResult, storeKey]);

  // Project mode: auto-connect (existing logic)
  useEffect(() => {
    if (isSshMode) return;
    if (autoConnectAttempted.current) return;
    if (isAvailable === null || !hasFetchedSessions) return;
    if (activeConfig) return;

    if (isAvailable === false) {
      autoConnectAttempted.current = true;
      setAutoConnectDone(true);
      return;
    }

    autoConnectAttempted.current = true;
    setAutoConnectDone(true);

    const slug =
      (project?.name ?? "default")
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\-_.]/g, "")
        .replace(/^-+|-+$/g, "") || "default";
    const firstSession = projectSessions[0];
    const name = firstSession ? firstSession.name : slug;

    const existsInTmux = sessions.some((s) => s.name === name);
    const isNewSession = !firstSession && !existsInTmux;

    handleConnect({
      projectId: projectId!,
      sessionName: name,
      cols: 80,
      rows: 24,
      cwd: project?.path,
      initialCommand: isNewSession && project?.agentType
        ? agentCommandsRef.current[project.agentType].command
        : undefined,
    });

    if (isNewSession && project?.path && project?.agentType) {
      setTimeout(async () => {
        try {
          const result = await restoreWorktreeWindows(name, project.path, project.agentType);
          if (result.restoredCount > 0) {
            console.log(
              `Restored ${result.restoredCount} worktree windows: ${result.worktreeNames.join(", ")}`,
            );
          }
        } catch (e) {
          console.warn("Failed to restore worktree windows:", e);
        }
      }, 800);
    }
  }, [
    isSshMode,
    isAvailable,
    isLoading,
    hasFetchedSessions,
    projectSessions.length,
    activeConfig,
    project?.name,
    project?.path,
    project?.agentType,
    projectId,
    handleConnect,
    projectSessions,
    sessions,
  ]);

  // SSH mode: detect disconnect from sidebar (store subscription)
  const sshStillActive = useSshStore((s) =>
    sshConnectionId ? s.isConnectionActive(sshConnectionId) : true,
  );

  useEffect(() => {
    if (isSshMode && !sshStillActive && activeConfig) {
      // Sidebar disconnect: clear activeConfig → TerminalView unmounts → PTY cleanup
      setActiveConfig(null);
      useTerminalStore.getState().setStatus(storeKey, "idle");
    }
  }, [isSshMode, sshStillActive, activeConfig, storeKey]);

  // --- SSH wake-triggered reconnect tracking ---
  // When macOS wakes from sleep, SSH TCP connections are usually dead.
  // This flag allows auto-reconnect only for wake-triggered disconnects,
  // not for general SSH failures (which would cause spawn loops).
  const wakePending = useRef(false);
  const wakePendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRetry = useCallback(() => {
    autoConnectAttempted.current = false;
    tmuxReconnectAttempted.current = false;
    sessionMonitorStarted.current = false;
    wakePending.current = false;
    if (wakePendingTimerRef.current) {
      clearTimeout(wakePendingTimerRef.current);
      wakePendingTimerRef.current = null;
    }
    setAutoConnectDone(false);
    setActiveConfig(null);
    setSshTmuxStatus("pending");
    useTerminalStore.getState().setStatus(storeKey, "idle");
  }, [storeKey]);

  useEffect(() => {
    if (!isSshMode) return;
    const handleWake = () => {
      console.info(`[TerminalPage] Wake detected — arming SSH auto-reconnect for '${storeKey}'`);
      wakePending.current = true;
      // Auto-clear after 60s in case disconnect never fires (e.g., connection survived sleep)
      if (wakePendingTimerRef.current) clearTimeout(wakePendingTimerRef.current);
      wakePendingTimerRef.current = setTimeout(() => {
        console.info(`[TerminalPage] Wake auto-reconnect expired (no disconnect within 60s) for '${storeKey}'`);
        wakePending.current = false;
        wakePendingTimerRef.current = null;
      }, 60_000);
    };
    window.addEventListener("app:wake", handleWake);
    return () => {
      window.removeEventListener("app:wake", handleWake);
      if (wakePendingTimerRef.current) {
        clearTimeout(wakePendingTimerRef.current);
        wakePendingTimerRef.current = null;
      }
    };
  }, [isSshMode]);

  // --- Auto-recover when re-activated after Kill All ---
  const prevActive = useRef(false);
  useEffect(() => {
    if (isActive && !prevActive.current && status === "error") {
      console.info(`[TerminalPage] Auto-recovering '${storeKey}' from error state`);
      handleRetry();
    }
    prevActive.current = isActive;
  }, [isActive, status, handleRetry, storeKey]);

  // --- Auto-reconnect on session disconnect ---
  const consecutiveDisconnects = useRef(0);
  const sessionMonitorStarted = useRef(false);

  // Start session monitoring once tmux session is confirmed connected.
  // Monitors non-hook agents (Codex) for activity via pane_monitor.
  useEffect(() => {
    if (status === "connected") {
      consecutiveDisconnects.current = 0;
      wakePending.current = false;

      if (!isSshMode && !sessionMonitorStarted.current && activeConfig?.sessionName && project?.path) {
        sessionMonitorStarted.current = true;
        startSessionMonitoring(activeConfig.sessionName, project.path).catch((e) => {
          console.warn("Failed to start session monitoring:", e);
        });
      }
    }
  }, [status, isSshMode, activeConfig?.sessionName, project?.path]);

  useEffect(() => {
    if (status === "disconnected") {
      // SSH mode: only auto-reconnect after wake events (sleep killed TCP).
      // Non-wake SSH disconnects (server down, user action) stay manual to prevent spawn loops.
      if (isSshMode) {
        if (!wakePending.current) return;
        // Don't consume wakePending here — keep it armed for retry chain.
        // It's consumed on success (status=connected) or max retries below.

        // Verify SSH session data is still available before attempting reconnect
        const activeResult = useSshStore.getState().getActiveResult(sshConnectionId!);
        if (!activeResult) {
          console.warn(`[TerminalPage] SSH wake-reconnect for '${storeKey}' aborted: session data lost`);
          wakePending.current = false;
          useTerminalStore.getState().setError(
            storeKey,
            "SSH session data was lost during sleep. Click Retry to reconnect.",
          );
          return;
        }

        console.info(`[TerminalPage] SSH disconnect after wake — auto-reconnecting '${storeKey}'`);
      }

      consecutiveDisconnects.current += 1;
      if (consecutiveDisconnects.current > 3) {
        wakePending.current = false;
        useTerminalStore.getState().setError(
          storeKey,
          isSshMode
            ? "SSH connection lost after sleep. Click Retry to reconnect."
            : "Session keeps disconnecting. Click Retry to try again.",
        );
        consecutiveDisconnects.current = 0;
        return;
      }
      // SSH: 2s delay for network stabilization (Wi-Fi reconnect after wake).
      // Local tmux: 500ms is sufficient.
      const delay = isSshMode ? 2000 : 500;
      const timer = setTimeout(handleRetry, delay);
      return () => clearTimeout(timer);
    }
  }, [status, isSshMode, handleRetry, storeKey, sshConnectionId]);

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

  // Remote tmux availability (SSH + confirmed remote tmux)
  const hasRemoteTmux =
    isSshMode &&
    sshTmuxStatus === "available" &&
    !!activeConfig?.remoteTmuxSessionName &&
    !!activeConfig?.sshConnectionId;

  // Build remote tmux callback overrides once, to avoid repetition in JSX props.
  // When hasRemoteTmux is false, all callbacks are undefined (local tmux used instead).
  // Callbacks return Promises so the toolbar can chain fetchWindows after completion.
  const remoteCallbacks = useMemo(() => {
    if (!hasRemoteTmux) return {};
    const cid = activeConfig?.sshConnectionId;
    const rsn = activeConfig?.remoteTmuxSessionName;
    if (!cid || !rsn) return {};
    // Capture narrowed values so closures see `string`, not `string | undefined`
    const connId: string = cid;
    const remoteSN: string = rsn;
    function withErrorSurface(
      fn: (c: string, s: string) => Promise<void>,
      label: string,
    ): () => Promise<void> {
      return () =>
        fn(connId, remoteSN).catch((e) => {
          console.error(`Remote ${label} failed:`, e);
          useTerminalStore.getState().setError(
            storeKey,
            `${label} failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
    }
    return {
      onCloseWindow: withErrorSurface(remoteTmuxCloseWindow, "Close window"),
      onNextWindow: withErrorSurface(remoteTmuxNextWindow, "Next window"),
      onPrevWindow: withErrorSurface(remoteTmuxPreviousWindow, "Previous window"),
      onClosePane: withErrorSurface(remoteTmuxClosePane, "Close pane"),
    };
  }, [hasRemoteTmux, activeConfig, storeKey]);

  const handleConfirmAction = useCallback(
    (startAgent: boolean, selectedAgentType?: AgentType, worktreeTaskName?: string) => {
      const action = pendingAction;
      const sessionName = activeConfig?.sessionName;
      const remoteSN = activeConfig?.remoteTmuxSessionName;
      const connId = activeConfig?.sshConnectionId;
      setPendingAction(null);

      if (!action || !sessionName) return;

      // Dispatch maps: action -> command for remote vs local tmux
      const remoteActions: Record<PaneAction, () => Promise<void>> = {
        "split-vertical": () => remoteTmuxSplitPaneVertical(connId!, remoteSN!),
        "split-horizontal": () => remoteTmuxSplitPaneHorizontal(connId!, remoteSN!),
        "new-window": () => remoteTmuxCreateWindow(connId!, remoteSN!),
      };
      const localActions: Record<PaneAction, () => Promise<void>> = {
        "split-vertical": () => splitTmuxPaneVertical(sessionName),
        "split-horizontal": () => splitTmuxPaneHorizontal(sessionName),
        "new-window": () => createTmuxWindow(sessionName),
      };

      const executeAction = async () => {
        const agentKey = selectedAgentType || project?.agentType || DEFAULT_AGENT_TYPE;

        // Worktree path: delegate entirely to startWorktreeTask IPC
        if (worktreeTaskName && project?.path) {
          await startWorktreeTask(sessionName, worktreeTaskName, project.path, agentKey);
          return;
        }

        const agentCommand = agentCommandsRef.current[agentKey].command;

        if (remoteSN && connId) {
          await remoteActions[action]();
          if (startAgent) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            await remoteTmuxSendKeys(connId, remoteSN, agentCommand);
          }
        } else if (!isSshMode) {
          await localActions[action]();
          if (startAgent) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            await sendTmuxKeys(sessionName, agentCommand);
          }
        } else {
          throw new Error(
            "Cannot execute tmux action: SSH mode is active but remote tmux is not configured",
          );
        }
      };

      executeAction()
        .catch((e) => {
          console.error(`Action ${action} failed:`, e);
          useTerminalStore.getState().setError(
            storeKey,
            `${action} failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        })
        .finally(() => refocusTerminal());
    },
    [isSshMode, pendingAction, activeConfig, refocusTerminal, storeKey, project?.agentType, project?.path],
  );

  const handleCancelAction = useCallback(() => {
    setPendingAction(null);
    refocusTerminal();
  }, [refocusTerminal]);

  // SSH mode: register PTY pid in store for orphan cleanup
  const handlePtySpawn = useCallback(
    (pid: number) => {
      if (isSshMode && sshConnectionId) {
        useSshStore.getState().registerSshPtyPid(sshConnectionId, pid);
      }
    },
    [isSshMode, sshConnectionId],
  );

  // Check if we have a valid subject (project or ssh connection)
  if (!isSshMode && !project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-muted">Project not found</p>
      </div>
    );
  }

  if (isSshMode && !sshConnection) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-muted">SSH connection not found</p>
      </div>
    );
  }

  // Rendering state decisions (priority order)
  const showLoading = !autoConnectDone && status !== "error";
  const showTmuxMissing = !isSshMode && autoConnectDone && isAvailable === false;
  const showSshNoTmux = isSshMode && autoConnectDone && sshTmuxStatus === "unavailable";
  const showSshDisconnected = isSshMode && status === "disconnected" && activeConfig;
  const showError = status === "error";
  const showTerminal = activeConfig && !showError && !showSshDisconnected;

  return (
    <div className="flex h-full flex-1 min-w-0 flex-col overflow-hidden">
      {showLoading && !showTerminal ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
            <p className="text-sm text-text-muted">
              {isSshMode ? "Connecting to SSH server..." : "Connecting..."}
            </p>
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
      ) : showSshNoTmux ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="glass-surface rounded-xl p-6 text-center max-w-md">
            <p className="text-sm text-text">tmux is not installed on this server</p>
            <p className="mt-3 text-xs text-text-muted">
              Install tmux on the remote server to enable terminal management:
            </p>
            <div className="mt-2 space-y-1.5 text-left">
              <p className="text-xs text-text-muted">
                <code className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono">
                  apt install tmux
                </code>{" "}
                <span className="text-text-muted/60">(Debian/Ubuntu)</span>
              </p>
              <p className="text-xs text-text-muted">
                <code className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono">
                  yum install tmux
                </code>{" "}
                <span className="text-text-muted/60">(RHEL/CentOS)</span>
              </p>
              <p className="text-xs text-text-muted">
                <code className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono">
                  brew install tmux
                </code>{" "}
                <span className="text-text-muted/60">(macOS)</span>
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={handleRetry}
            >
              Retry
            </Button>
          </div>
        </div>
      ) : showSshDisconnected ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="glass-surface rounded-xl border border-warning/30 p-4 text-center max-w-md">
            <p className="text-sm text-text">SSH connection closed</p>
            <p className="mt-1 text-xs text-text-muted">
              Reconnect from the sidebar to start a new session.
            </p>
          </div>
        </div>
      ) : showError ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="glass-surface rounded-xl border border-danger/30 p-4 text-center max-w-md">
            <p className="text-sm text-danger">Connection failed</p>
            {errorMessage && (
              <p className="mt-1 text-xs text-text-muted break-words">
                {errorMessage}
              </p>
            )}
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
          {(!isSshMode || hasRemoteTmux) && (
            <>
              <WindowToolbar
                sessionName={activeConfig.sessionName}
                disabled={status !== "connected"}
                onRequestAction={handleRequestAction}
                title={isSshMode ? sshConnection?.name : project?.name}
                onError={(msg) => useTerminalStore.getState().setError(storeKey, msg)}
                onCloseWindow={remoteCallbacks.onCloseWindow}
                onNextWindow={remoteCallbacks.onNextWindow}
                onPrevWindow={remoteCallbacks.onPrevWindow}
              />
              <PaneToolbar
                sessionName={activeConfig.sessionName}
                disabled={status !== "connected"}
                onRequestAction={handleRequestAction}
                onToggleThemePicker={handleToggleThemePicker}
                onClosePane={remoteCallbacks.onClosePane}
              />
            </>
          )}
          <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
            <TerminalView
              key={activeConfig.sessionName}
              config={activeConfig}
              isActive={isActive}
              glassClassName="terminal-glass"
              onRequestPaneAction={handleRequestAction}
              onPtySpawn={isSshMode ? handlePtySpawn : undefined}
            />
            <ThemePickerPanel
              open={themePickerOpen}
              onClose={handleCloseThemePicker}
            />
          </div>
        </div>
      ) : null}
      {isActive && (!isSshMode || hasRemoteTmux) && (
        <NewPaneDialog
          action={pendingAction}
          onConfirm={handleConfirmAction}
          onCancel={handleCancelAction}
          defaultAgentType={project?.agentType || DEFAULT_AGENT_TYPE}
          projectPath={project?.path}
          isSshMode={isSshMode}
        />
      )}
    </div>
  );
}

export default TerminalPage;
export { TerminalPage };
