import { BrowserRouter } from "react-router-dom";
import { AppProviders } from "./providers";
import { AppRoutes } from "./routes";
import { Sidebar } from "../components/layout/Sidebar";
import { StatusBar } from "../components/layout/StatusBar";
import { CommandPalette } from "../components/layout/CommandPalette";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { useEffect, useState } from "react";
import { checkTmuxAvailable } from "../lib/tauri/commands";
import { useProjectStore } from "../features/project/stores/projectStore";

function AppShell() {
  const { isCommandPaletteOpen, setCommandPaletteOpen } = useGlobalShortcuts();
  const [tmuxAvailable, setTmuxAvailable] = useState<boolean | null>(null);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);

  useEffect(() => {
    // Load core data on app start (survives page reloads)
    fetchProjects();
    checkTmuxAvailable()
      .then(setTmuxAvailable)
      .catch(() => setTmuxAvailable(false));
  }, [fetchProjects]);

  return (
    <div className="flex h-screen w-screen flex-col bg-bg text-text">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <AppRoutes />
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
