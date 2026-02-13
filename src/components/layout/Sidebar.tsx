import { useState, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useProjectStore } from "../../features/project/stores/projectStore";
import { StatusIndicator } from "../../features/project/components/StatusIndicator";
import { COLOR_PALETTE } from "../../features/project/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ProjectForm } from "../../features/project/components/ProjectForm";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  const allProjects = useProjectStore((s) => s.projects);
  const deletingIds = useProjectStore((s) => s.deletingIds);
  const projects = useMemo(
    () => allProjects.filter((p) => p.isActive && !deletingIds.has(p.id)),
    [allProjects, deletingIds],
  );
  const selectedId = useProjectStore((s) => s.selectedId);
  const selectProject = useProjectStore((s) => s.selectProject);
  const createProject = useProjectStore((s) => s.createProject);
  const isCreating = useProjectStore((s) => s.isCreating);

  const navigate = useNavigate();
  const location = useLocation();

  const [isAddOpen, setIsAddOpen] = useState(false);

  const handleSelectProject = (id: string) => {
    selectProject(id);
    navigate(`/projects/${id}`);
  };

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border bg-bg transition-[width] duration-200",
        collapsed ? "w-[var(--sidebar-collapsed-width)]" : "w-[var(--sidebar-width)]",
      )}
    >
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        {!collapsed && (
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Projects
          </span>
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

      {/* Project list */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {projects.map((project) => {
          const colorVar =
            COLOR_PALETTE[project.colorIndex] ?? COLOR_PALETTE[0];
          const isActive =
            selectedId === project.id ||
            location.pathname === `/projects/${project.id}`;

          return (
            <button
              key={project.id}
              onClick={() => handleSelectProject(project.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                isActive
                  ? "bg-surface text-text"
                  : "text-text-secondary hover:bg-surface-hover hover:text-text",
              )}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: colorVar }}
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
      </nav>

      {/* Add project button */}
      <div className="border-t border-border p-2">
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className={cn("w-full", !collapsed && "justify-start gap-2")}
          onClick={() => setIsAddOpen(true)}
        >
          <Plus className="h-4 w-4" />
          {!collapsed && <span>Add Project</span>}
        </Button>
      </div>

      {/* Add project dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
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
    </aside>
  );
}

export { Sidebar };
