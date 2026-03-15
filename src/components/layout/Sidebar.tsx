import { Component, useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { ErrorInfo, ReactNode } from "react";
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
  Bot,
  Settings,
  Globe,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useProjectStore } from "../../features/project/stores/projectStore";
import {
  useAgentActivityStore,
  AgentStatusBadge,
} from "../../features/git";
import { useSshStore, SshConnectionForm } from "../../features/ssh";
import { checkSshRemoteTmux, AGENT_TYPES } from "../../lib/tauri/commands";
import { StatusIndicator } from "../../features/project/components/StatusIndicator";
import { ProjectEditForm } from "../../features/project/components/ProjectEditForm";
import { COLOR_PALETTE } from "../../features/project/types";
import type { Project } from "../../features/project/types";
import type { SshConnection } from "../../features/ssh";
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

/* ── Error boundary for sidebar list panels ── */
interface ListErrorBoundaryProps {
  fallbackLabel: string;
  children: ReactNode;
}

interface ListErrorBoundaryState {
  hasError: boolean;
}

class ListErrorBoundary extends Component<ListErrorBoundaryProps, ListErrorBoundaryState> {
  state: ListErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ListErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[Sidebar] ${this.props.fallbackLabel} rendering failed:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <p className="px-2 py-4 text-center text-xs text-danger">
          Failed to load {this.props.fallbackLabel}. Try switching tabs.
        </p>
      );
    }
    return this.props.children;
  }
}

/* ── Presentational: shared between SortableProjectItem and DragOverlay ── */
interface ProjectItemContentProps {
  project: Project;
  isActive: boolean;
  collapsed: boolean;
  colorVar: string;
  shortcutDigit?: number;
}

function ProjectItemContent({ project, isActive, collapsed, colorVar, shortcutDigit }: ProjectItemContentProps) {
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
          {shortcutDigit !== undefined && (
            <kbd className="shrink-0 text-[10px] leading-none text-text-muted/50 font-mono">
              ⌘{shortcutDigit}
            </kbd>
          )}
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
  shortcutDigit?: number;
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
  shortcutDigit,
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
        "relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm cursor-grab active:cursor-grabbing",
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
        shortcutDigit={shortcutDigit}
      />
      {dropPosition === "below" && (
        <div className="absolute -bottom-px left-2 right-2 h-0.5 rounded-full bg-primary z-10" />
      )}
    </div>
  );
}

const AGENT_STATUS_PRIORITY: Record<string, number> = {
  active: 0, loading: 0, ready: 2, done: 3, error: 4, idle: 5,
};

const NO_SESSION_PRIORITY = 6;

function agentSortPriority(session: { status: string; isWaitingForInput?: boolean } | undefined): number {
  if (!session) return NO_SESSION_PRIORITY;
  if (session.isWaitingForInput) return 1;
  return AGENT_STATUS_PRIORITY[session.status] ?? 5;
}

function isAgentBusy(session: { status: string } | undefined): boolean {
  return session?.status === "active" || session?.status === "loading";
}

function shortAgentLabel(agentType: string): string {
  // Normalize snake_case ("codex_cli") to camelCase ("codexCli") for AGENT_TYPES lookup
  const normalized = agentType.includes("_")
    ? agentType.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    : agentType;

  if (normalized in AGENT_TYPES) {
    const label = AGENT_TYPES[normalized as keyof typeof AGENT_TYPES].label;
    const spaceIdx = label.indexOf(" ");
    return spaceIdx > 0 ? label.slice(0, spaceIdx) : label;
  }
  // camelCase fallback: "claudeCode" → "Claude"
  const spaced = normalized.replace(/([a-z])([A-Z])/g, "$1 $2");
  const idx = spaced.indexOf(" ");
  const first = idx > 0 ? spaced.slice(0, idx) : spaced;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function sidebarWidthClass(hidden: boolean, collapsed: boolean): string {
  if (hidden) return "w-0 overflow-hidden border-r-0";
  if (collapsed) return "w-[var(--sidebar-collapsed-width)]";
  return "w-[var(--sidebar-width)]";
}

function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const hidden = useAppStore((s) => s.sidebarHidden);
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

  // Agent activity state — use getProjectSession for project-level aggregation
  // (includes worktree sessions), keyed by sessions reference for reactivity.
  const agentSessions = useAgentActivityStore((s) => s.sessions);
  const getProjectSession = useAgentActivityStore((s) => s.getProjectSession);

  const activeAgentCount = useMemo(
    () => projects.filter((p) => isAgentBusy(getProjectSession(p.path))).length,
    [projects, agentSessions, getProjectSession],
  );

  const sortedAgentProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const sessionA = getProjectSession(a.path);
      const sessionB = getProjectSession(b.path);

      const prioDiff = agentSortPriority(sessionA) - agentSortPriority(sessionB);
      if (prioDiff !== 0) return prioDiff;

      // Same priority: most recent activity first
      return (sessionB?.lastActivity ?? "").localeCompare(sessionA?.lastActivity ?? "");
    });
  }, [projects, agentSessions, getProjectSession]);

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
    window.addEventListener("kova:new-project", handleNewProject);
    return () => window.removeEventListener("kova:new-project", handleNewProject);
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

  const handleTabSwitch = (mode: "projects" | "agents") => {
    setSidebarMode(mode);
    if (mode === "projects") {
      navigate(selectedId ? `/projects/${selectedId}/terminal` : "/");
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
        "flex h-full flex-col border-r border-white/[0.10] glass-surface relative z-10",
        sidebarWidthClass(hidden, collapsed),
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
          <div className="relative grid grid-cols-2 rounded-lg p-0.5 glass-inset">
            <span
              className="sidebar-tab-indicator"
              data-active={sidebarMode}
            />
            <button
              onClick={() => handleTabSwitch("projects")}
              className={cn(
                "relative z-[1] rounded-md px-2.5 py-1 text-center text-xs font-semibold uppercase tracking-wider transition-colors duration-150",
                sidebarMode === "projects"
                  ? "text-text"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              Projects
            </button>
            <button
              onClick={() => handleTabSwitch("agents")}
              className={cn(
                "relative z-[1] rounded-md px-2.5 py-1 text-center text-xs font-semibold uppercase tracking-wider transition-colors duration-150",
                sidebarMode === "agents"
                  ? "text-text"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              Agents
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
              onClick={() => handleTabSwitch("agents")}
              className={cn(
                "relative rounded-md p-1 transition-all duration-150",
                sidebarMode === "agents"
                  ? "bg-white/[0.15] text-text shadow-sm shadow-black/25"
                  : "text-text-muted hover:text-text-secondary hover:bg-white/[0.04]",
              )}
              aria-label="Agents"
              title="Agents"
            >
              <Bot className="h-4 w-4" />
              {activeAgentCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-success px-0.5 text-[9px] font-bold text-white">
                  {activeAgentCount}
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

      {/* List area — switches between Projects and Agents */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {sidebarMode === "projects" ? (
          /* ───── Project list ───── */
          <ListErrorBoundary key="projects" fallbackLabel="project list">
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

                  let shortcutDigit: number | undefined;
                  if (index < 9) shortcutDigit = index + 1;
                  else if (index === 9) shortcutDigit = 0;

                  return (
                    <SortableProjectItem
                      key={project.id}
                      project={project}
                      isActive={isItemActive}
                      collapsed={collapsed}
                      colorVar={colorVar}
                      shortcutDigit={shortcutDigit}
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
          </ListErrorBoundary>
        ) : (
          /* ───── Agents list ───── */
          <ListErrorBoundary key="agents" fallbackLabel="agent activity">
          <div key="agents" className="sidebar-list-enter-agents space-y-1">
            {sortedAgentProjects.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-text-muted">
                No projects registered
              </p>
            )}

            {sortedAgentProjects.map((project) => {
              const colorVar =
                COLOR_PALETTE[project.colorIndex] ?? COLOR_PALETTE[0];
              const session = getProjectSession(project.path);
              const isItemActive =
                selectedId === project.id ||
                location.pathname.startsWith(`/projects/${project.id}`);
              const isAgentActive = isAgentBusy(session);

              return (
                <div
                  key={project.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectProject(project.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelectProject(project.id);
                    }
                  }}
                  onMouseEnter={preloadTerminal}
                  className={cn(
                    "sidebar-item-hover group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm cursor-pointer",
                    isAgentActive && "agent-breathing",
                    isItemActive
                      ? "sidebar-item-active text-text"
                      : "text-text-secondary hover:bg-white/[0.08] hover:text-text",
                  )}
                  style={{
                    '--item-color': colorVar,
                    ...(isAgentActive ? { '--breath-color': 'oklch(0.65 0.18 145 / 0.25)' } : {}),
                  } as React.CSSProperties}
                >
                  <span
                    className={cn(
                      "shrink-0 rounded-sm transition-all duration-150",
                      isItemActive ? "h-3.5 w-3.5" : "h-3 w-3",
                    )}
                    style={{
                      backgroundColor: colorVar,
                      ...(isItemActive ? { boxShadow: `0 0 8px ${colorVar}` } : {}),
                    }}
                  />
                  {!collapsed && (
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="truncate flex-1 text-sm">{project.name}</span>
                        <span className="shrink-0 text-[9px] text-text-muted/60 font-medium">
                          {shortAgentLabel(session?.detectedAgentType ?? project.agentType)}
                        </span>
                      </div>
                      {session ? (
                        <div className="mt-0.5">
                          <AgentStatusBadge
                            status={session.status}
                            lastMessage={session.lastMessage}
                            toolUseCount={session.toolUseCount}
                            fileEditCount={session.fileEditCount}
                            commitCount={session.commitCount}
                            errorCount={session.errorCount}
                            isWaitingForInput={session.isWaitingForInput}
                          />
                        </div>
                      ) : (
                        <span className="block text-[11px] text-text-muted/50">
                          No activity
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </ListErrorBoundary>
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
                  const isActive = location.pathname.startsWith(`/ssh/${conn.id}/`);

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
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className={cn("w-full", !collapsed && "justify-start gap-2")}
          onClick={() => setIsAddOpen(true)}
        >
          <Plus className="h-4 w-4" />
          {!collapsed && <span>Add Project</span>}
        </Button>
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
            <DialogDescription>Add a new project to manage with Kova</DialogDescription>
          </DialogHeader>
          <ProjectForm
            onSubmit={async (input) => {
              const project = await createProject(input);
              if (project) setIsAddOpen(false);
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

    </aside>
  );
}

export { Sidebar };
