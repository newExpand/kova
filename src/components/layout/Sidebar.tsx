import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  Globe,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useProjectStore } from "../../features/project/stores/projectStore";
import { useTmuxStore } from "../../features/tmux";
import { useSshStore } from "../../features/ssh";
import { SshConnectionForm } from "../../features/ssh";
import { killTmuxSession, checkSshRemoteTmux } from "../../lib/tauri/commands";
import { StatusIndicator } from "../../features/project/components/StatusIndicator";
import { ProjectEditForm } from "../../features/project/components/ProjectEditForm";
import { COLOR_PALETTE } from "../../features/project/types";
import type { Project } from "../../features/project/types";
import type { SshConnection } from "../../features/ssh";
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

/* ── Presentational: shared between SortableProjectItem and DragOverlay ── */
interface ProjectItemContentProps {
  project: Project;
  isActive: boolean;
  collapsed: boolean;
  colorVar: string;
}

function ProjectItemContent({ project, isActive, collapsed, colorVar }: ProjectItemContentProps) {
  return (
    <>
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
          <StatusIndicator active={project.isActive} className="ml-auto" />
        </>
      )}
    </>
  );
}

/* ── Sortable wrapper: hooks into @dnd-kit ── */
interface SortableProjectItemProps {
  project: Project;
  isActive: boolean;
  collapsed: boolean;
  colorVar: string;
  index: number;
  dropPosition?: "above" | "below" | null;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onHover: () => void;
}

function SortableProjectItem({
  project,
  isActive,
  collapsed,
  colorVar,
  index,
  dropPosition,
  onSelect,
  onContextMenu,
  onHover,
}: SortableProjectItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: project.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    '--item-color': colorVar,
    '--stagger-index': Math.min(index, 6),
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={onHover}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "relative sidebar-item-stagger flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm cursor-grab active:cursor-grabbing",
        isDragging && "border border-dashed border-white/20 rounded-lg",
        isActive
          ? "sidebar-item-active text-text"
          : "sidebar-item-hover text-text-secondary hover:bg-white/[0.08] hover:text-text",
      )}
      style={style}
    >
      {dropPosition === "above" && (
        <div className="absolute -top-px left-2 right-2 h-0.5 rounded-full bg-primary z-10" />
      )}
      <ProjectItemContent
        project={project}
        isActive={isActive}
        collapsed={collapsed}
        colorVar={colorVar}
      />
      {dropPosition === "below" && (
        <div className="absolute -bottom-px left-2 right-2 h-0.5 rounded-full bg-primary z-10" />
      )}
    </div>
  );
}

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
  const reorderProjects = useProjectStore((s) => s.reorderProjects);

  // --- @dnd-kit drag state ---
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverId(event.over ? String(event.over.id) : null);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverId(null);
    if (!over || active.id === over.id) return;

    const oldIndex = projects.findIndex((p) => p.id === active.id);
    const newIndex = projects.findIndex((p) => p.id === String(over.id));
    if (oldIndex === -1 || newIndex === -1) {
      console.warn(
        `[Sidebar] Drag end aborted: project not found in list. ` +
        `activeId=${String(active.id)}, overId=${String(over.id)}, ` +
        `projects.length=${projects.length}`,
      );
      return;
    }

    const newOrder = arrayMove(projects, oldIndex, newIndex);
    reorderProjects(newOrder);
  }, [projects, reorderProjects]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverId(null);
  }, []);

  const activeProject = useMemo(
    () => (activeId ? projects.find((p) => p.id === activeId) : null),
    [activeId, projects],
  );

  const activeIndex = useMemo(
    () => (activeId ? projects.findIndex((p) => p.id === activeId) : -1),
    [activeId, projects],
  );

  // Tmux session state
  const sessions = useTmuxStore((s) => s.sessions);
  const isLoadingSessions = useTmuxStore((s) => s.isLoading);
  const fetchSessions = useTmuxStore((s) => s.fetchSessions);

  // SSH state — individual selectors to avoid re-render loops
  const sshConnections = useSshStore((s) => s.connections);
  const sshError = useSshStore((s) => s.error);
  const fetchSshConnections = useSshStore((s) => s.fetchConnections);
  const connectSession = useSshStore((s) => s.connectSession);
  const sshDeleteConnection = useSshStore((s) => s.deleteConnection);

  const navigate = useNavigate();
  const location = useLocation();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [killTarget, setKillTarget] = useState<SessionInfo | null>(null);
  const [isKilling, setIsKilling] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SSH sidebar state
  const [sshExpanded, setSshExpanded] = useState(false);
  const [sshFormOpen, setSshFormOpen] = useState(false);
  const [sshEditTarget, setSshEditTarget] = useState<SshConnection | null>(null);
  const [sshDeleteTarget, setSshDeleteTarget] = useState<SshConnection | null>(null);

  // Fetch SSH connections on mount + pre-warm tmux availability checks
  useEffect(() => {
    let cancelled = false;

    fetchSshConnections()
      .then(() => {
        if (cancelled) return;
        // Pre-warm: check remote tmux availability in background
        // Results are cached in sshStore for instant connection on click
        const { connections, tmuxCheckCache } = useSshStore.getState();
        for (const conn of connections) {
          if (conn.id in tmuxCheckCache) continue; // already checked

          checkSshRemoteTmux(conn.id)
            .then((result) => {
              if (!cancelled) {
                useSshStore.getState().cacheTmuxCheck(conn.id, result);
              }
            })
            .catch((err) => {
              console.warn(`[SSH] Pre-warm tmux check failed for ${conn.id}:`, err);
            });
        }
      })
      .catch((e) => {
        console.error("[SSH] Failed to fetch connections:", e);
      });

    return () => { cancelled = true; };
  }, [fetchSshConnections]);

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
    setKillError(null);
    try {
      await killTmuxSession(killTarget.name);
      await fetchSessions();
      setKillTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Sidebar] Failed to kill session '${killTarget.name}':`, err);
      setKillError(`Failed to kill '${killTarget.name}': ${message}`);
    } finally {
      setIsKilling(false);
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

  // SSH handlers
  const handleSelectSsh = async (conn: SshConnection) => {
    try {
      selectProject(null);
      await connectSession(conn.id);
      navigate(`/ssh/${conn.id}/terminal`);
    } catch (e) {
      console.error(`[SSH] Connection to '${conn.name}' failed:`, e);
      // error is set in store and displayed via sshError
    }
  };

  const handleEditSsh = (conn: SshConnection) => {
    setSshEditTarget(conn);
  };

  const handleDeleteSsh = (conn: SshConnection) => {
    setSshDeleteTarget(conn);
  };

  const handleDeleteSshConfirm = async () => {
    if (!sshDeleteTarget) return;
    try {
      await sshDeleteConnection(sshDeleteTarget.id);
      setSshDeleteTarget(null);
    } catch (e) {
      console.error(`[SSH] Delete failed for '${sshDeleteTarget.name}':`, e);
      // Keep dialog open — error is displayed via sshError
    }
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <div key="projects" className="sidebar-list-enter-projects space-y-0.5">
                {projects.map((project, index) => {
                  const colorVar =
                    COLOR_PALETTE[project.colorIndex] ?? COLOR_PALETTE[0];
                  const isItemActive =
                    selectedId === project.id ||
                    location.pathname.startsWith(`/projects/${project.id}`);

                  let dropPosition: "above" | "below" | null = null;
                  if (activeId && overId === project.id && activeId !== project.id) {
                    dropPosition = activeIndex < index ? "below" : "above";
                  }

                  return (
                    <SortableProjectItem
                      key={project.id}
                      project={project}
                      isActive={isItemActive}
                      collapsed={collapsed}
                      colorVar={colorVar}
                      index={index}
                      dropPosition={dropPosition}
                      onSelect={() => handleSelectProject(project.id)}
                      onContextMenu={(e) => handleContextMenu(e, project)}
                      onHover={preloadTerminal}
                    />
                  );
                })}
              </div>
            </SortableContext>

            {/* Ghost preview — always mounted, children conditional */}
            <DragOverlay
              dropAnimation={{
                duration: 200,
                easing: "cubic-bezier(0.2, 0, 0, 1)",
                sideEffects: defaultDropAnimationSideEffects({
                  styles: { active: { opacity: "0.4" } },
                }),
              }}
            >
              {activeProject ? (
                <div
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm bg-surface/90 backdrop-blur-sm border border-white/[0.15] shadow-[0_8px_32px_rgba(0,0,0,0.4)] cursor-grabbing"
                  style={{ opacity: 0.9 }}
                >
                  <ProjectItemContent
                    project={activeProject}
                    isActive={false}
                    collapsed={collapsed}
                    colorVar={COLOR_PALETTE[activeProject.colorIndex] ?? COLOR_PALETTE[0]}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          /* ───── Sessions list ───── */
          <div key="sessions" className="sidebar-list-enter-sessions space-y-0.5">
            {sessions.length === 0 && !isLoadingSessions && (
              <p className="px-2 py-4 text-center text-xs text-text-muted">
                No tmux sessions
              </p>
            )}

            {sessions.map((session, index) => {
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
          </div>
        )}
      </nav>

      {/* SSH collapsible section — above bottom actions */}
      <div className="border-t border-white/[0.06]">
        <button
          onClick={() => setSshExpanded(!sshExpanded)}
          className="group flex w-full items-center gap-1.5 px-3 py-2 text-xs text-text-muted hover:text-text-secondary hover:bg-white/[0.04] active:scale-[0.98] transition-all duration-150 rounded-md"
        >
          <ChevronRight
            className={cn("h-3 w-3 transition-transform duration-200", sshExpanded && "rotate-90")}
            style={{ transitionTimingFunction: "var(--ease-out-expo)" }}
          />
          {!collapsed && <span className="font-medium uppercase tracking-wider">SSH</span>}
          {!collapsed && sshConnections.length > 0 && (
            <span className="ml-auto flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-white/[0.06] text-[9px] text-text-muted transition-colors duration-200 group-hover:bg-white/[0.12]">
              {sshConnections.length}
            </span>
          )}
          {collapsed && (
            <Globe className="h-3.5 w-3.5" />
          )}
        </button>

        {!collapsed && (
          <div className="ssh-accordion-grid" data-expanded={sshExpanded}>
            <div className="ssh-accordion-inner">
              <div className="px-2 pb-2 pt-0.5 space-y-0.5">
                {sshError && (
                  <p className="px-2 py-1 text-[10px] text-danger truncate" title={sshError}>
                    {sshError}
                  </p>
                )}
                {sshConnections.map((conn, i) => {
                  const isActive = location.pathname === `/ssh/${conn.id}/terminal`;
                  return (
                    <div
                      key={conn.id}
                      className="ssh-item-stagger group relative flex items-center rounded-lg"
                      style={{ '--stagger-index': i } as React.CSSProperties}
                    >
                      <button
                        onClick={() => handleSelectSsh(conn)}
                        onMouseEnter={preloadTerminal}
                        className={cn(
                          "sidebar-item-hover flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm pr-10",
                          isActive
                            ? "bg-primary/10 border border-primary/20 text-text"
                            : "text-text-secondary hover:bg-white/[0.08]",
                        )}
                      >
                        <Globe className={cn(
                          "h-3 w-3 shrink-0 transition-colors duration-200",
                          isActive ? "ssh-globe-connected" : "text-text-muted",
                        )} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs truncate">{conn.name}</p>
                          <p className="text-[10px] text-text-muted truncate">
                            {conn.username}@{conn.host}
                          </p>
                        </div>
                      </button>
                      <div className="ssh-action-icon absolute right-1.5 flex items-center gap-0.5">
                        <button
                          title="Edit"
                          onClick={() => handleEditSsh(conn)}
                          className="h-5 w-5 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-white/[0.08] transition-colors"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          title="Delete"
                          onClick={() => handleDeleteSsh(conn)}
                          className="h-5 w-5 flex items-center justify-center rounded text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                <button
                  onClick={() => setSshFormOpen(true)}
                  className="ssh-item-stagger flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-text-muted hover:bg-white/[0.08] hover:text-text-secondary active:scale-[0.98] transition-all"
                  style={{ '--stagger-index': sshConnections.length } as React.CSSProperties}
                >
                  <Plus className="h-3 w-3" />
                  <span>Add SSH Connection</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

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

      {/* SSH Connection form (new / edit) */}
      {(sshFormOpen || sshEditTarget) && (
        <SshConnectionForm
          open={sshFormOpen || !!sshEditTarget}
          onOpenChange={(open) => {
            if (!open) {
              setSshFormOpen(false);
              setSshEditTarget(null);
            }
          }}
          editConnection={sshEditTarget}
          projectId={null}
        />
      )}

      {/* SSH delete confirmation dialog */}
      <Dialog
        open={!!sshDeleteTarget}
        onOpenChange={(open) => {
          if (!open) setSshDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete SSH Connection</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{sshDeleteTarget?.name}&quot;?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSshDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteSshConfirm}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kill session confirmation dialog */}
      <Dialog
        open={!!killTarget}
        onOpenChange={(open) => {
          if (!open) {
            setKillTarget(null);
            setKillError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kill Session</DialogTitle>
            <DialogDescription>
              {`'${killTarget?.name ?? ""}' `}
              Are you sure you want to kill this session?
            </DialogDescription>
          </DialogHeader>
          {killError && (
            <p className="text-sm text-danger">{killError}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setKillTarget(null)}
              disabled={isKilling}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleKillSession}
              disabled={isKilling}
            >
              {isKilling ? "Killing..." : "Kill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

export { Sidebar };
