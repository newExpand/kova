import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  FolderOpen,
  Monitor,
  RefreshCw,
  Settings,
  X,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useProjectStore } from "../../features/project/stores/projectStore";
import { useTmuxStore, useSessionClassification } from "../../features/tmux";
import { killTmuxSession } from "../../lib/tauri/commands";
import { StatusIndicator } from "../../features/project/components/StatusIndicator";
import { ProjectEditForm } from "../../features/project/components/ProjectEditForm";
import { COLOR_PALETTE } from "../../features/project/types";
import type { Project } from "../../features/project/types";
import type { SessionInfo } from "../../features/tmux/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "../ui/dialog";
import { ProjectForm } from "../../features/project/components/ProjectForm";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

// Preload TerminalPage chunk on hover
const preloadTerminal = () => import("../../features/terminal/components/TerminalPage");

interface ContextMenuState {
  x: number;
  y: number;
  project: Project;
}

const DELETE_CONFIRM_MS = 5_000;

function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const sidebarMode = useAppStore((s) => s.sidebarMode);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);

  const allProjects = useProjectStore((s) => s.projects);
  const deletingIds = useProjectStore((s) => s.deletingIds);
  const projects = useMemo(
    () => allProjects.filter((p) => p.isActive && !deletingIds.has(p.id)),
    [allProjects, deletingIds],
  );
  const selectedId = useProjectStore((s) => s.selectedId);
  const selectProject = useProjectStore((s) => s.selectProject);
  const createProject = useProjectStore((s) => s.createProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const confirmDelete = useProjectStore((s) => s.confirmDelete);
  const isCreating = useProjectStore((s) => s.isCreating);
  const getProjectById = useProjectStore((s) => s.getProjectById);

  // Tmux session state
  const sessions = useTmuxStore((s) => s.sessions);
  const isLoadingSessions = useTmuxStore((s) => s.isLoading);
  const fetchSessions = useTmuxStore((s) => s.fetchSessions);

  const { appSessions, externalSessions } = useSessionClassification(sessions);

  const navigate = useNavigate();
  const location = useLocation();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [killTarget, setKillTarget] = useState<SessionInfo | null>(null);
  const [isKilling, setIsKilling] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close context menu on outside click or Escape
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  useEffect(() => {
    if (!ctxMenu) return;

    const handleClick = () => closeCtxMenu();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCtxMenu();
    };

    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ctxMenu, closeCtxMenu]);

  // Listen for "New Project" event from CommandPalette / Cmd+N
  useEffect(() => {
    const handleNewProject = () => setIsAddOpen(true);
    window.addEventListener("flow-orche:new-project", handleNewProject);
    return () => window.removeEventListener("flow-orche:new-project", handleNewProject);
  }, []);

  // Cleanup delete timer on unmount
  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const handleSelectProject = (id: string) => {
    selectProject(id);
    navigate(`/projects/${id}/terminal`);
  };

  const handleTabSwitch = (mode: "projects" | "sessions") => {
    setSidebarMode(mode);
    if (mode === "sessions") {
      fetchSessions();
      navigate("/sessions");
    } else {
      // Return to selected project or home
      const pid = selectedId;
      navigate(pid ? `/projects/${pid}/terminal` : "/");
    }
  };

  const handleKillSession = async () => {
    if (!killTarget) return;
    setIsKilling(true);
    try {
      await killTmuxSession(killTarget.name);
      await fetchSessions();
    } finally {
      setIsKilling(false);
      setKillTarget(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, project: Project) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, project });
  };

  const handleEdit = () => {
    if (!ctxMenu) return;
    setEditTarget(ctxMenu.project);
    closeCtxMenu();
  };

  const handleDelete = () => {
    if (!ctxMenu) return;
    const id = ctxMenu.project.id;
    deleteProject(id);
    closeCtxMenu();

    // Auto-confirm after 5 seconds (matching ProjectGrid pattern)
    deleteTimerRef.current = setTimeout(() => {
      confirmDelete(id);
      deleteTimerRef.current = null;
    }, DELETE_CONFIRM_MS);
  };

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-white/[0.10] glass-surface relative z-10 transition-[width] duration-200",
        collapsed ? "w-[var(--sidebar-collapsed-width)]" : "w-[var(--sidebar-width)]",
      )}
    >
      {/* Traffic light spacer — macOS overlay titlebar */}
      <div
        data-tauri-drag-region
        className="h-[38px] shrink-0"
      />
      {/* Header with tab toggle */}
      <div className="flex h-12 items-center justify-between border-b border-white/[0.08] px-3">
        {!collapsed ? (
          <div className="relative flex items-center gap-0.5 rounded-lg p-0.5 glass-inset">
            <span
              className="sidebar-tab-indicator"
              data-active={sidebarMode}
            />
            <button
              onClick={() => handleTabSwitch("projects")}
              className={cn(
                "relative z-[1] flex-1 rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-colors duration-150",
                sidebarMode === "projects"
                  ? "text-text"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              Projects
            </button>
            <button
              onClick={() => handleTabSwitch("sessions")}
              className={cn(
                "relative z-[1] flex-1 rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-colors duration-150",
                sidebarMode === "sessions"
                  ? "text-text"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              Sessions
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5 rounded-lg p-0.5 glass-inset">
            <button
              onClick={() => handleTabSwitch("projects")}
              className={cn(
                "rounded-md p-1 transition-all duration-150",
                sidebarMode === "projects"
                  ? "bg-white/[0.15] text-text shadow-sm shadow-black/25"
                  : "text-text-muted hover:text-text-secondary hover:bg-white/[0.04]",
              )}
              aria-label="Projects"
              title="Projects"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleTabSwitch("sessions")}
              className={cn(
                "relative rounded-md p-1 transition-all duration-150",
                sidebarMode === "sessions"
                  ? "bg-white/[0.15] text-text shadow-sm shadow-black/25"
                  : "text-text-muted hover:text-text-secondary hover:bg-white/[0.04]",
              )}
              aria-label="Sessions"
              title="Sessions"
            >
              <Monitor className="h-4 w-4" />
              {sessions.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-white">
                  {sessions.length}
                </span>
              )}
            </button>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* List area — switches between Projects and Sessions */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {sidebarMode === "projects" ? (
          /* ───── Project list ───── */
          <div key="projects" className="sidebar-list-enter-projects space-y-0.5">
            {projects.map((project, index) => {
              const colorVar =
                COLOR_PALETTE[project.colorIndex] ?? COLOR_PALETTE[0];
              const isActive =
                selectedId === project.id ||
                location.pathname.startsWith(`/projects/${project.id}`);

              return (
                <button
                  key={project.id}
                  onClick={() => handleSelectProject(project.id)}
                  onContextMenu={(e) => handleContextMenu(e, project)}
                  onMouseEnter={preloadTerminal}
                  className={cn(
                    "sidebar-item-stagger flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm",
                    isActive
                      ? "sidebar-item-active text-text"
                      : "sidebar-item-hover text-text-secondary hover:bg-white/[0.08] hover:text-text",
                  )}
                  style={{
                    '--item-color': colorVar,
                    '--stagger-index': Math.min(index, 6),
                  } as React.CSSProperties}
                >
                  <span
                    className={cn(
                      "shrink-0 rounded-sm transition-all duration-150",
                      isActive ? "h-3.5 w-3.5" : "h-3 w-3",
                    )}
                    style={{
                      backgroundColor: colorVar,
                      ...(isActive ? { boxShadow: `0 0 8px ${colorVar}` } : {}),
                    }}
                  />
                  {!collapsed && (
                    <>
                      <span className="truncate flex-1">{project.name}</span>
                      <StatusIndicator
                        active={project.isActive}
                        className="ml-auto"
                      />
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          /* ───── Sessions list ───── */
          <div key="sessions" className="sidebar-list-enter-sessions space-y-0.5">
            {sessions.length === 0 && !isLoadingSessions && (
              <p className="px-2 py-4 text-center text-xs text-text-muted">
                No tmux sessions
              </p>
            )}

            {appSessions.length > 0 && !collapsed && (
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                App Sessions
              </p>
            )}
            {appSessions.map((session, index) => {
              const projName = session.projectId
                ? getProjectById(session.projectId)?.name
                : null;
              return (
                <div
                  key={session.name}
                  className="sidebar-item-stagger sidebar-item-hover group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-text-secondary hover:bg-white/[0.08] hover:text-text"
                  style={{ '--stagger-index': Math.min(index, 6) } as React.CSSProperties}
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      session.attached ? "bg-success" : "bg-text-muted",
                    )}
                  />
                  {!collapsed && (
                    <>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{session.name}</span>
                        <span className="block truncate text-[10px] text-text-muted">
                          {session.windows}w{projName ? ` \u00b7 ${projName}` : ""}
                        </span>
                      </div>
                      <button
                        onClick={() => setKillTarget(session)}
                        className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:text-danger group-hover:flex"
                        aria-label={`Kill session ${session.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}

            {externalSessions.length > 0 && !collapsed && (
              <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                External Sessions
              </p>
            )}
            {externalSessions.map((session, exIdx) => (
              <div
                key={session.name}
                className="sidebar-item-stagger sidebar-item-hover group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-text-secondary hover:bg-white/[0.08] hover:text-text"
                style={{ '--stagger-index': Math.min(appSessions.length + exIdx, 6) } as React.CSSProperties}
              >
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    session.attached ? "bg-success" : "bg-text-muted",
                  )}
                />
                {!collapsed && (
                  <>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{session.name}</span>
                      <span className="block truncate text-[10px] text-text-muted">
                        {session.windows}w
                      </span>
                    </div>
                    <button
                      onClick={() => setKillTarget(session)}
                      className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:text-danger group-hover:flex"
                      aria-label={`Kill session ${session.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-white/[0.10] p-2 space-y-0.5 bg-black/[0.08]">
        {sidebarMode === "projects" ? (
          <Button
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            className={cn("w-full", !collapsed && "justify-start gap-2")}
            onClick={() => setIsAddOpen(true)}
          >
            <Plus className="h-4 w-4" />
            {!collapsed && <span>Add Project</span>}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            className={cn("w-full", !collapsed && "justify-start gap-2")}
            onClick={() => fetchSessions()}
            disabled={isLoadingSessions}
          >
            <RefreshCw className={cn("h-4 w-4", isLoadingSessions && "animate-spin")} />
            {!collapsed && <span>Refresh</span>}
          </Button>
        )}
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className={cn(
            "w-full",
            !collapsed && "justify-start gap-2",
            location.pathname === "/settings" && "bg-white/[0.10] border border-white/[0.08] text-text",
          )}
          onClick={() => navigate("/settings")}
        >
          <Settings className="h-4 w-4" />
          {!collapsed && <span>Settings</span>}
        </Button>
      </div>

      {/* Add project dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>Add a new project to manage with Clew</DialogDescription>
          </DialogHeader>
          <ProjectForm
            onSubmit={async (input) => {
              await createProject(input);
              setIsAddOpen(false);
            }}
            onCancel={() => setIsAddOpen(false)}
            isSubmitting={isCreating}
          />
        </DialogContent>
      </Dialog>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="sidebar-context-menu fixed z-50 min-w-[140px] rounded-xl border border-white/[0.15] glass-elevated p-1"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
        >
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-text hover:bg-white/[0.08] transition-colors"
            onClick={handleEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-danger hover:bg-white/[0.08] transition-colors"
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}

      {/* Edit project dialog */}
      {editTarget && (
        <ProjectEditForm
          project={editTarget}
          open={!!editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          onSave={updateProject}
        />
      )}

      {/* Kill session confirmation dialog */}
      <Dialog
        open={!!killTarget}
        onOpenChange={(open) => {
          if (!open) setKillTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kill Session</DialogTitle>
            <DialogDescription>
              {`'${killTarget?.name ?? ""}' `}
              세션을 종료하시겠습니까?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setKillTarget(null)}
              disabled={isKilling}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleKillSession}
              disabled={isKilling}
            >
              {isKilling ? "종료 중..." : "종료"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

export { Sidebar };
