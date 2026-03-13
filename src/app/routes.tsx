import { lazy, Suspense, useEffect, useCallback, useRef } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { TerminalSquare, Command } from "lucide-react";
import { useTmuxStore } from "../features/tmux";
import { useGitStore } from "../features/git";
import { useSshGitStore, useSshStore } from "../features/ssh";
import { SettingsPage } from "../features/settings";
import { getShortcutById } from "../lib/shortcuts";
import { useLRUPool } from "../hooks/useLRUPool";

// Lazy-load TerminalPage (xterm.js is in this chunk)
const TerminalPage = lazy(
  () => import("../features/terminal/components/TerminalPage"),
);

// Lazy-load GitGraphPage (d3-shape + motion in git-viz chunk)
const GitGraphPage = lazy(
  () => import("../features/git/components/GitGraphPage"),
);

// Lazy-load SshGitGraphPage (SSH remote git graph)
const SshGitGraphPage = lazy(
  () => import("../features/ssh/components/SshGitGraphPage"),
);

const TERMINAL_ROUTE_PATTERN = /^\/projects\/([^/]+)\/terminal$/;
const GIT_ROUTE_PATTERN = /^\/projects\/([^/]+)\/git$/;
const SSH_TERMINAL_ROUTE_PATTERN = /^\/ssh\/([^/]+)\/terminal$/;
const SSH_GIT_ROUTE_PATTERN = /^\/ssh\/([^/]+)\/git$/;

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

function useSshGitRouteMatch(): {
  isSshGitRoute: boolean;
  activeConnectionId: string | null;
} {
  const location = useLocation();
  const match = location.pathname.match(SSH_GIT_ROUTE_PATTERN);
  return {
    isSshGitRoute: !!match,
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
          {(["command-palette", "new-project"] as const).map((id) => {
            const def = getShortcutById(id);
            if (!def) return null;
            return (
              <div key={id} className="flex items-center gap-2">
                <kbd className="inline-flex h-6 items-center gap-0.5 rounded-lg glass-inset border border-white/[0.10] px-2 font-mono text-[10px] text-text-secondary">
                  <Command className="h-2.5 w-2.5" />{def.key.toUpperCase()}
                </kbd>
                <span>{def.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Layout-level terminal pool — survives route navigation, bounded LRU (max 2) */
function TerminalPool() {
  const { isTerminalRoute, activeProjectId } = useTerminalRouteMatch();

  // No onEvict for session monitors: they are global services started at boot
  // (lib.rs:232) and should outlive the UI pool. They self-terminate when the
  // tmux session is destroyed or the 24h max lifetime is reached.
  const visitedProjects = useLRUPool(activeProjectId, 2);

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

/** Layout-level SSH terminal pool — mirrors TerminalPool for SSH connections, bounded LRU (max 2) */
function SshTerminalPool() {
  const { isSshTerminalRoute, activeConnectionId } = useSshTerminalRouteMatch();

  // Clean up orphaned store entries on eviction.
  // PTY is already killed by useTerminal's unmount cleanup.
  const handleSshTerminalEvict = useCallback((evictedId: string) => {
    const state = useSshStore.getState();
    const { [evictedId]: _pid, ...remainPids } = state.sshPtyPids;
    const { [evictedId]: _conn, ...remainConn } = state.activeConnections;
    useSshStore.setState({
      sshPtyPids: remainPids,
      activeConnections: remainConn,
    });
  }, []);

  const visitedConnections = useLRUPool(activeConnectionId, 2, handleSshTerminalEvict);

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

/** Layout-level git graph pool — survives route navigation, bounded LRU (max 2) */
function GitGraphPool() {
  const { isGitRoute, activeProjectId } = useGitRouteMatch();
  const prevActiveRef = useRef<string | null>(null);

  // Trim inactive graph to 50 commits to save memory while keeping it in the pool.
  // Full clearProject happens on eviction; useGitPolling refetches 200 on re-activation.
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = activeProjectId;
    if (prev && prev !== activeProjectId) {
      useGitStore.getState().trimProject(prev);
    }
  }, [activeProjectId]);

  const handleGitEvict = useCallback((evictedId: string) => {
    useGitStore.getState().clearProject(evictedId);
  }, []);
  const visitedProjects = useLRUPool(activeProjectId, 2, handleGitEvict);

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

/** Layout-level SSH git graph pool — survives route navigation, bounded LRU (max 2) */
function SshGitGraphPool() {
  const { isSshGitRoute, activeConnectionId } = useSshGitRouteMatch();
  const prevActiveRef = useRef<string | null>(null);

  // Trim inactive graph to 50 commits to save memory while keeping it in the pool.
  // Full clearConnection happens on eviction; SSH polling refetches on re-activation.
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = activeConnectionId;
    if (prev && prev !== activeConnectionId) {
      useSshGitStore.getState().trimConnection(prev);
    }
  }, [activeConnectionId]);

  const handleSshGitEvict = useCallback((evictedId: string) => {
    useSshGitStore.getState().clearConnection(evictedId);
  }, []);
  const visitedConnections = useLRUPool(activeConnectionId, 2, handleSshGitEvict);

  return (
    <div
      className="flex flex-1 min-w-0 flex-col overflow-hidden"
      style={isSshGitRoute ? undefined : { display: "none" }}
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text-muted">Loading git graph...</p>
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
            <SshGitGraphPage
              connectionId={cid}
              isActive={cid === activeConnectionId}
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
  const { isSshTerminalRoute } = useSshTerminalRouteMatch();
  const { isSshGitRoute } = useSshGitRouteMatch();
  const isPoolRoute = isTerminalRoute || isGitRoute || isSshTerminalRoute || isSshGitRoute;

  return (
    <>
      <main
        className="flex flex-1 min-w-0 flex-col overflow-hidden"
        style={isPoolRoute ? { display: "none" } : undefined}
      >
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/projects/:projectId" element={<Navigate to="terminal" replace />} />
          <Route path="/projects/:projectId/terminal" element={<></>} />
          <Route path="/projects/:projectId/git" element={<></>} />
          <Route path="/ssh/:connectionId/terminal" element={<></>} />
          <Route path="/ssh/:connectionId/git" element={<></>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TerminalPool />
      <SshTerminalPool />
      <GitGraphPool />
      <SshGitGraphPool />
    </>
  );
}

export { AppRoutes };
