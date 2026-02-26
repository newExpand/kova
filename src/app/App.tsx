import { BrowserRouter, useNavigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { AppProviders } from "./providers";
import { AppRoutes } from "./routes";
import { Sidebar } from "../components/layout/Sidebar";
import { StatusBar } from "../components/layout/StatusBar";
import { CommandPalette } from "../components/layout/CommandPalette";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { ErrorBoundary } from "../components/ui/error-boundary";
import { checkTmuxAvailable } from "../lib/tauri/commands";
import { useProjectStore } from "../features/project/stores/projectStore";
import { useSettingsStore } from "../features/settings/stores/settingsStore";
import { useAppStore } from "../stores/appStore";
import { ProjectTabSwitcher } from "../features/git";

const FileViewerPanel = lazy(() => import("../components/layout/FileViewerPanel"));

const PROJECT_ROUTE_PATTERN = /^\/projects\/([^/]+)\//;

function TitleBar() {
  const location = useLocation();
  const match = location.pathname.match(PROJECT_ROUTE_PATTERN);
  const projectId = match?.[1] ?? null;

  return (
    <header
      data-tauri-drag-region
      className="flex h-[38px] shrink-0 items-center border-b border-white/[0.06] glass-toolbar"
    >
      {/* Left spacer for macOS traffic lights */}
      <div className="min-w-[80px] flex-1" />
      {projectId ? (
        <ProjectTabSwitcher projectId={projectId} />
      ) : (
        <span className="text-xs font-medium tracking-wide text-text-muted select-none">
          Clew
        </span>
      )}
      {/* Right spacer */}
      <div className="flex-1" />
    </header>
  );
}

function AppShell() {
  const { isCommandPaletteOpen, setCommandPaletteOpen } = useGlobalShortcuts();
  const isFileViewerPanelOpen = useAppStore((s) => s.isFileViewerPanelOpen);
  const [tmuxAvailable, setTmuxAvailable] = useState<boolean | null>(null);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const navigate = useNavigate();
  const pendingProjectNavigation = useAppStore(
    (s) => s.pendingProjectNavigation,
  );

  useEffect(() => {
    // Load core data on app start (survives page reloads)
    fetchProjects();
    fetchSettings();
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
          <AppRoutes />
        </div>
      </div>
      <StatusBar connected={true} tmuxAvailable={tmuxAvailable} />
      <CommandPalette
        open={isCommandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />
      <AnimatePresence>
        {isFileViewerPanelOpen && (
          <ErrorBoundary
            fallback={() => (
              <div className="fixed right-4 bottom-12 z-50 rounded-lg glass-elevated px-4 py-3 text-xs text-text-secondary">
                <p>Failed to load file viewer.</p>
                <button
                  type="button"
                  onClick={() => useAppStore.getState().setFileViewerPanelOpen(false)}
                  className="mt-1 text-primary hover:underline"
                >
                  Dismiss
                </button>
              </div>
            )}
          >
            <Suspense
              fallback={
                <div className="fixed right-0 top-0 bottom-0 z-50 flex items-center justify-center glass-elevated border-l border-white/[0.10]"
                  style={{ width: Math.max(320, window.innerWidth * 0.45) }}
                >
                  <span className="text-sm text-text-muted animate-pulse">Loading...</span>
                </div>
              }
            >
              <FileViewerPanel />
            </Suspense>
          </ErrorBoundary>
        )}
      </AnimatePresence>
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
