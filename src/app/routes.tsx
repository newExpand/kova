import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { TerminalSquare, Command } from "lucide-react";
import { SessionManagerPage } from "../features/tmux";

// Lazy-load TerminalPage (xterm.js is in this chunk)
const TerminalPage = lazy(
  () => import("../features/terminal/components/TerminalPage"),
);

function WelcomePage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-8 animate-in fade-in duration-500">
        {/* Terminal prompt icon */}
        <div className="relative flex items-center justify-center">
          <div className="absolute h-24 w-24 rounded-2xl bg-primary/[0.06]" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-2xl border border-border-subtle">
            <TerminalSquare className="h-10 w-10 text-text-muted" strokeWidth={1.5} />
          </div>
        </div>

        {/* Text */}
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-base font-medium text-text-secondary">
            No project selected
          </h2>
          <p className="text-sm text-text-muted">
            Select a project from the sidebar to open a terminal session
          </p>
        </div>

        {/* Shortcut hints */}
        <div className="flex items-center gap-6 text-xs text-text-muted">
          <div className="flex items-center gap-2">
            <kbd className="inline-flex h-5 items-center gap-0.5 rounded border border-border bg-bg-secondary px-1.5 font-mono text-[10px] text-text-secondary">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
            <span>Command palette</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="inline-flex h-5 items-center gap-0.5 rounded border border-border bg-bg-secondary px-1.5 font-mono text-[10px] text-text-secondary">
              <Command className="h-2.5 w-2.5" />N
            </kbd>
            <span>New project</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Wrapper that keys TerminalPage by projectId → full remount on project switch */
function TerminalRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-text-muted">Loading terminal...</p>
        </div>
      }
    >
      <TerminalPage key={projectId} />
    </Suspense>
  );
}

function AppRoutes() {
  return (
    <main className="flex-1 min-w-0 h-full">
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/sessions" element={<SessionManagerPage />} />
        <Route path="/projects/:projectId" element={<Navigate to="terminal" replace />} />
        <Route path="/projects/:projectId/terminal" element={<TerminalRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
}

export { AppRoutes };
