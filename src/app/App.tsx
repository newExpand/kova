import { BrowserRouter, useNavigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { AppProviders } from "./providers";
import { AppRoutes } from "./routes";
import { Sidebar } from "../components/layout/Sidebar";
import { StatusBar } from "../components/layout/StatusBar";
import { CommandPalette } from "../components/layout/CommandPalette";
import { ShortcutsHelpModal } from "../components/layout/ShortcutsHelpModal";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { ErrorBoundary } from "../components/ui/error-boundary";
import { checkTmuxAvailable } from "../lib/tauri/commands";
import { useProjectStore } from "../features/project/stores/projectStore";
import { useSettingsStore } from "../features/settings/stores/settingsStore";
import { useAppStore } from "../stores/appStore";
import { useAgentFileTrackingStore } from "../features/files";
import { useSplitPanelResize } from "../hooks/useSplitPanelResize";
import { ProjectTabSwitcher } from "../features/git";
import { SshTabSwitcher, useSshStore } from "../features/ssh";
import { cn } from "../lib/utils";

const FileViewerPanel = lazy(() => import("../components/layout/FileViewerPanel"));

const DIVIDER_WIDTH = 6;
const MIN_PANEL_WIDTH = 320;
const MIN_CONTENT_WIDTH = 400;

const PROJECT_ROUTE_PATTERN = /^\/projects\/([^/]+)\//;
const SSH_ROUTE_PATTERN = /^\/ssh\/([^/]+)\//;

function TitleBar() {
  const location = useLocation();
  const projectMatch = location.pathname.match(PROJECT_ROUTE_PATTERN);
  const projectId = projectMatch?.[1] ?? null;
  const sshMatch = location.pathname.match(SSH_ROUTE_PATTERN);
  const sshConnectionId = sshMatch?.[1] ?? null;
  const sshConnection = useSshStore((s) =>
    sshConnectionId ? s.getConnectionById(sshConnectionId) : undefined,
  );
  const showSshTabs = sshConnectionId && sshConnection?.remoteProjectPath;

  return (
    <header
      data-tauri-drag-region
      className="flex h-[38px] shrink-0 items-center border-b border-white/[0.06] glass-toolbar"
    >
      {/* Left spacer for macOS traffic lights */}
      <div className="min-w-[80px] flex-1" />
      {projectId ? (
        <ProjectTabSwitcher projectId={projectId} />
      ) : showSshTabs ? (
        <SshTabSwitcher connectionId={sshConnectionId} />
      ) : (
        <span className="text-xs font-medium tracking-wide text-text-muted select-none">
          Clew
        </span>
      )}
      {/* Right spacer */}
      <div className="flex-1" data-tauri-drag-region />
    </header>
  );
}

function SplitDivider({ onMouseDown, isResizing }: { onMouseDown: (e: React.MouseEvent) => void; isResizing: boolean }) {
  return (
    <div
      className="w-1.5 flex-shrink-0 cursor-col-resize split-divider-indicator transition-colors"
      data-resizing={isResizing}
      onMouseDown={onMouseDown}
    />
  );
}

function AppShell() {
  const {
    isCommandPaletteOpen, setCommandPaletteOpen,
    isShortcutsHelpOpen, setShortcutsHelpOpen,
  } = useGlobalShortcuts();
  const isFileViewerPanelOpen = useAppStore((s) => s.isFileViewerPanelOpen);
  const isFileViewerMaximized = useAppStore((s) => s.isFileViewerMaximized);
  const fileViewerPanelWidth = useAppStore((s) => s.fileViewerPanelWidth);
  const setFileViewerPanelWidth = useAppStore((s) => s.setFileViewerPanelWidth);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [tmuxAvailable, setTmuxAvailable] = useState<boolean | null>(null);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const navigate = useNavigate();
  const pendingProjectNavigation = useAppStore(
    (s) => s.pendingProjectNavigation,
  );

  const { handleMouseDown: handleDividerMouseDown, isResizing } = useSplitPanelResize({
    panelWidth: fileViewerPanelWidth,
    onWidthChange: setFileViewerPanelWidth,
    minPanelWidth: MIN_PANEL_WIDTH,
    minContentWidth: MIN_CONTENT_WIDTH,
    containerRef: splitContainerRef,
  });

  useEffect(() => {
    // Load core data on app start (survives page reloads)
    fetchProjects();
    fetchSettings();
    useAgentFileTrackingStore
      .getState()
      .restoreWorkingSets()
      .catch((err) => console.error("[App] failed to restore working sets:", err));
    checkTmuxAvailable()
      .then(setTmuxAvailable)
      .catch(() => setTmuxAvailable(false));
  }, [fetchProjects, fetchSettings]);

  // Handle notification click → navigate to project terminal
  useEffect(() => {
    if (pendingProjectNavigation) {
      useProjectStore.getState().selectProject(pendingProjectNavigation);
      navigate(`/projects/${pendingProjectNavigation}/terminal`);
      useAppStore.getState().setPendingProjectNavigation(null);
    }
  }, [pendingProjectNavigation, navigate]);

  // CommandPalette → Open shortcuts help modal
  useEffect(() => {
    function handleOpenShortcutsHelp() {
      setShortcutsHelpOpen(true);
    }
    window.addEventListener("flow-orche:open-shortcuts-help", handleOpenShortcutsHelp);
    return () =>
      window.removeEventListener("flow-orche:open-shortcuts-help", handleOpenShortcutsHelp);
  }, [setShortcutsHelpOpen]);

  // Cmd+Shift+G → Toggle Terminal ↔ Git Graph
  useEffect(() => {
    function handleToggleGit() {
      const selectedId = useProjectStore.getState().selectedId;
      if (!selectedId) return;
      const path = window.location.pathname;
      if (path.includes("/git")) {
        navigate(`/projects/${selectedId}/terminal`);
      } else {
        navigate(`/projects/${selectedId}/git`);
      }
    }
    window.addEventListener("flow-orche:toggle-git", handleToggleGit);
    return () =>
      window.removeEventListener("flow-orche:toggle-git", handleToggleGit);
  }, [navigate]);

  return (
    <div className="flex h-screen w-screen flex-col glass-gradient-bg text-text relative">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 min-w-0 flex-col">
          {/* Custom glass titlebar */}
          <TitleBar />
          {/* Split container: route content + file viewer panel */}
          <div ref={splitContainerRef} className="flex flex-1 overflow-hidden">
            {/* Route content (terminal, git, files, etc.) — hidden (not unmounted) when maximized */}
            <div
              className={cn(
                "flex flex-1 min-w-0 flex-col",
                isFileViewerMaximized && isFileViewerPanelOpen && "hidden",
              )}
            >
              <AppRoutes />
            </div>
            {/* File viewer split panel */}
            {isFileViewerPanelOpen && (
              <div
                className={cn(
                  "flex overflow-hidden",
                  isFileViewerMaximized ? "flex-1" : "flex-shrink-0",
                )}
                style={
                  isFileViewerMaximized
                    ? undefined
                    : { width: fileViewerPanelWidth + DIVIDER_WIDTH }
                }
              >
                {!isFileViewerMaximized && (
                  <SplitDivider onMouseDown={handleDividerMouseDown} isResizing={isResizing} />
                )}
                <div className="flex flex-1 min-w-0 overflow-hidden glass-surface border-l border-white/[0.10]">
                  <ErrorBoundary
                    fallback={(error, reset) => (
                      <div className="flex flex-1 items-center justify-center p-4">
                        <div className="rounded-lg glass-elevated px-4 py-3 text-xs text-text-secondary">
                          <p>Failed to load file viewer.</p>
                          <p className="mt-1 text-text-muted truncate max-w-xs" title={error.message}>
                            {error.message}
                          </p>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={reset}
                              className="text-primary hover:underline"
                            >
                              Retry
                            </button>
                            <button
                              type="button"
                              onClick={() => useAppStore.getState().setFileViewerPanelOpen(false)}
                              className="text-text-muted hover:underline"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  >
                    <Suspense
                      fallback={
                        <div className="flex flex-1 items-center justify-center">
                          <span className="text-sm text-text-muted animate-pulse">Loading...</span>
                        </div>
                      }
                    >
                      <FileViewerPanel />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <StatusBar connected={true} tmuxAvailable={tmuxAvailable} />
      <CommandPalette
        open={isCommandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />
      <ShortcutsHelpModal
        open={isShortcutsHelpOpen}
        onOpenChange={setShortcutsHelpOpen}
      />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppShell />
      </AppProviders>
    </BrowserRouter>
  );
}

export default App;
