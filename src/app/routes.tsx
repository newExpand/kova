import { lazy, Suspense, useState, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { TerminalSquare, Command } from "lucide-react";
import { SessionManagerPage, useTmuxStore } from "../features/tmux";
import { SettingsPage } from "../features/settings";

// Lazy-load TerminalPage (xterm.js is in this chunk)
const TerminalPage = lazy(
  () => import("../features/terminal/components/TerminalPage"),
);

// Lazy-load GitGraphPage (d3-shape + motion in git-viz chunk)
const GitGraphPage = lazy(
  () => import("../features/git/components/GitGraphPage"),
);

// Lazy-load FilesPage (codemirror chunk)
const FilesPage = lazy(
  () => import("../features/files/components/FilesPage"),
);

const TERMINAL_ROUTE_PATTERN = /^\/projects\/([^/]+)\/terminal$/;
const GIT_ROUTE_PATTERN = /^\/projects\/([^/]+)\/git$/;
const FILES_ROUTE_PATTERN = /^\/projects\/([^/]+)\/files$/;
const SSH_TERMINAL_ROUTE_PATTERN = /^\/ssh\/([^/]+)\/terminal$/;

function useTerminalRouteMatch(): {
  isTerminalRoute: boolean;
  activeProjectId: string | null;
} {
  const location = useLocation();
  const match = location.pathname.match(TERMINAL_ROUTE_PATTERN);
  return {
    isTerminalRoute: !!match,
    activeProjectId: match?.[1] ?? null,
  };
}

function useGitRouteMatch(): {
  isGitRoute: boolean;
  activeProjectId: string | null;
} {
  const location = useLocation();
  const match = location.pathname.match(GIT_ROUTE_PATTERN);
  return {
    isGitRoute: !!match,
    activeProjectId: match?.[1] ?? null,
  };
}

function useFilesRouteMatch(): {
  isFilesRoute: boolean;
  activeProjectId: string | null;
} {
  const location = useLocation();
  const match = location.pathname.match(FILES_ROUTE_PATTERN);
  return {
    isFilesRoute: !!match,
    activeProjectId: match?.[1] ?? null,
  };
}

function useSshTerminalRouteMatch(): {
  isSshTerminalRoute: boolean;
  activeConnectionId: string | null;
} {
  const location = useLocation();
  const match = location.pathname.match(SSH_TERMINAL_ROUTE_PATTERN);
  return {
    isSshTerminalRoute: !!match,
    activeConnectionId: match?.[1] ?? null,
  };
}

function WelcomePage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-8 animate-in fade-in duration-500">
        {/* Terminal prompt icon */}
        <div className="relative flex items-center justify-center">
          {/* Ambient glow */}
          <div className="absolute h-40 w-40 rounded-full bg-primary/[0.08] blur-2xl glass-hero-glow" />
          {/* Glass icon container */}
          <div className="relative flex h-28 w-28 items-center justify-center rounded-3xl glass-elevated glass-specular border border-white/[0.15]">
            <TerminalSquare className="h-12 w-12 text-text-secondary" strokeWidth={1.5} />
          </div>
        </div>

        {/* Text */}
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-text-secondary">
            No project selected
          </h2>
          <p className="text-sm text-text-muted">
            Select a project from the sidebar to open a terminal session
          </p>
        </div>

        {/* Shortcut hints */}
        <div className="flex items-center gap-6 text-xs text-text-muted">
          <div className="flex items-center gap-2">
            <kbd className="inline-flex h-6 items-center gap-0.5 rounded-lg glass-inset border border-white/[0.10] px-2 font-mono text-[10px] text-text-secondary">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
            <span>Command palette</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="inline-flex h-6 items-center gap-0.5 rounded-lg glass-inset border border-white/[0.10] px-2 font-mono text-[10px] text-text-secondary">
              <Command className="h-2.5 w-2.5" />N
            </kbd>
            <span>New project</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Layout-level terminal pool — survives route navigation */
function TerminalPool() {
  const { isTerminalRoute, activeProjectId } = useTerminalRouteMatch();
  const [visitedProjects, setVisitedProjects] = useState<string[]>([]);

  // Add first-visited project to pool
  useEffect(() => {
    if (activeProjectId) {
      setVisitedProjects((prev) =>
        prev.includes(activeProjectId) ? prev : [...prev, activeProjectId],
      );
    }
  }, [activeProjectId]);

  // Clear tmux error state on project switch (only when entering a terminal)
  useEffect(() => {
    if (activeProjectId) {
      useTmuxStore.setState({ error: null });
    }
  }, [activeProjectId]);

  return (
    <div
      className="flex flex-1 min-w-0 flex-col overflow-hidden"
      style={isTerminalRoute ? undefined : { display: "none" }}
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text-muted">Loading terminal...</p>
          </div>
        }
      >
        {visitedProjects.map((pid) => (
          <div
            key={pid}
            style={{
              display: pid === activeProjectId ? "flex" : "none",
              flex: 1,
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <TerminalPage
              projectId={pid}
              isActive={pid === activeProjectId}
            />
          </div>
        ))}
      </Suspense>
    </div>
  );
}

/** Layout-level SSH terminal pool — mirrors TerminalPool for SSH connections */
function SshTerminalPool() {
  const { isSshTerminalRoute, activeConnectionId } = useSshTerminalRouteMatch();
  const [visitedConnections, setVisitedConnections] = useState<string[]>([]);

  useEffect(() => {
    if (activeConnectionId) {
      setVisitedConnections((prev) =>
        prev.includes(activeConnectionId) ? prev : [...prev, activeConnectionId],
      );
    }
  }, [activeConnectionId]);

  return (
    <div
      className="flex flex-1 min-w-0 flex-col overflow-hidden"
      style={isSshTerminalRoute ? undefined : { display: "none" }}
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text-muted">Loading terminal...</p>
          </div>
        }
      >
        {visitedConnections.map((cid) => (
          <div
            key={cid}
            style={{
              display: cid === activeConnectionId ? "flex" : "none",
              flex: 1,
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <TerminalPage
              sshConnectionId={cid}
              isActive={cid === activeConnectionId}
            />
          </div>
        ))}
      </Suspense>
    </div>
  );
}

/** Layout-level git graph pool — survives route navigation (mirrors TerminalPool) */
function GitGraphPool() {
  const { isGitRoute, activeProjectId } = useGitRouteMatch();
  const [visitedProjects, setVisitedProjects] = useState<string[]>([]);

  useEffect(() => {
    if (activeProjectId) {
      setVisitedProjects((prev) =>
        prev.includes(activeProjectId) ? prev : [...prev, activeProjectId],
      );
    }
  }, [activeProjectId]);

  return (
    <div
      className="flex flex-1 min-w-0 flex-col overflow-hidden"
      style={isGitRoute ? undefined : { display: "none" }}
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text-muted">Loading git graph...</p>
          </div>
        }
      >
        {visitedProjects.map((pid) => (
          <div
            key={pid}
            style={{
              display: pid === activeProjectId ? "flex" : "none",
              flex: 1,
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <GitGraphPage
              projectId={pid}
              isActive={pid === activeProjectId}
            />
          </div>
        ))}
      </Suspense>
    </div>
  );
}

/** Layout-level files pool — survives route navigation (mirrors TerminalPool) */
function FilesPool() {
  const { isFilesRoute, activeProjectId } = useFilesRouteMatch();
  const [visitedProjects, setVisitedProjects] = useState<string[]>([]);

  useEffect(() => {
    if (activeProjectId) {
      setVisitedProjects((prev) =>
        prev.includes(activeProjectId) ? prev : [...prev, activeProjectId],
      );
    }
  }, [activeProjectId]);

  return (
    <div
      className="flex flex-1 min-w-0 flex-col overflow-hidden"
      style={isFilesRoute ? undefined : { display: "none" }}
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text-muted">Loading files...</p>
          </div>
        }
      >
        {visitedProjects.map((pid) => (
          <div
            key={pid}
            style={{
              display: pid === activeProjectId ? "flex" : "none",
              flex: 1,
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <FilesPage
              projectId={pid}
              isActive={pid === activeProjectId}
            />
          </div>
        ))}
      </Suspense>
    </div>
  );
}

function AppRoutes() {
  const { isTerminalRoute } = useTerminalRouteMatch();
  const { isGitRoute } = useGitRouteMatch();
  const { isFilesRoute } = useFilesRouteMatch();
  const { isSshTerminalRoute } = useSshTerminalRouteMatch();
  const isPoolRoute = isTerminalRoute || isGitRoute || isFilesRoute || isSshTerminalRoute;

  return (
    <>
      <main
        className="flex flex-1 min-w-0 flex-col overflow-hidden"
        style={isPoolRoute ? { display: "none" } : undefined}
      >
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/sessions" element={<SessionManagerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/projects/:projectId" element={<Navigate to="terminal" replace />} />
          <Route path="/projects/:projectId/terminal" element={<></>} />
          <Route path="/projects/:projectId/git" element={<></>} />
          <Route path="/projects/:projectId/files" element={<></>} />
          <Route path="/ssh/:connectionId/terminal" element={<></>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TerminalPool />
      <SshTerminalPool />
      <GitGraphPool />
      <FilesPool />
    </>
  );
}

export { AppRoutes };
