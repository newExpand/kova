import { BrowserRouter, useNavigate } from "react-router-dom";
import { AppProviders } from "./providers";
import { AppRoutes } from "./routes";
import { Sidebar } from "../components/layout/Sidebar";
import { StatusBar } from "../components/layout/StatusBar";
import { CommandPalette } from "../components/layout/CommandPalette";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { useEffect, useState } from "react";
import { checkTmuxAvailable } from "../lib/tauri/commands";
import { useProjectStore } from "../features/project/stores/projectStore";
import { useSettingsStore } from "../features/settings/stores/settingsStore";
import { useAppStore } from "../stores/appStore";

function AppShell() {
  const { isCommandPaletteOpen, setCommandPaletteOpen } = useGlobalShortcuts();
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

  return (
    <div className="flex h-screen w-screen flex-col glass-gradient-bg text-text relative">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 min-w-0 flex-col">
          {/* Custom glass titlebar */}
          <header
            data-tauri-drag-region
            className="flex h-[38px] shrink-0 items-center border-b border-white/[0.06] glass-toolbar"
          >
            <span className="mx-auto text-xs font-medium tracking-wide text-text-muted select-none">
              Clew
            </span>
          </header>
          <AppRoutes />
        </div>
      </div>
      <StatusBar connected={true} tmuxAvailable={tmuxAvailable} />
      <CommandPalette
        open={isCommandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
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
