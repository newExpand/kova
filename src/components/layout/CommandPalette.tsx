import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Plus, Settings } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "../ui/command";
import { useProjectStore } from "../../features/project/stores/projectStore";
import { COLOR_PALETTE } from "../../features/project/types";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const allProjects = useProjectStore((s) => s.projects);
  const deletingIds = useProjectStore((s) => s.deletingIds);
  const projects = useMemo(
    () => allProjects.filter((p) => p.isActive && !deletingIds.has(p.id)),
    [allProjects, deletingIds],
  );
  const selectProject = useProjectStore((s) => s.selectProject);
  const navigate = useNavigate();

  const handleSelectProject = useCallback(
    (id: string) => {
      selectProject(id);
      navigate(`/projects/${id}`);
      onOpenChange(false);
    },
    [selectProject, navigate, onOpenChange],
  );

  const handleNewProject = useCallback(() => {
    navigate("/");
    onOpenChange(false);
  }, [navigate, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search projects..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={handleNewProject}>
            <Plus className="h-4 w-4" />
            <span>New Project</span>
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              navigate("/settings");
              onOpenChange(false);
            }}
          >
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </CommandItem>
        </CommandGroup>

        {projects.length > 0 && (
          <CommandGroup heading="Projects">
            {projects.map((project) => {
              const colorVar =
                COLOR_PALETTE[project.colorIndex] ?? COLOR_PALETTE[0];
              return (
                <CommandItem
                  key={project.id}
                  onSelect={() => handleSelectProject(project.id)}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: colorVar }}
                  />
                  <FolderOpen className="h-4 w-4" />
                  <span>{project.name}</span>
                  <span className="ml-auto text-xs text-text-muted font-mono truncate max-w-[200px]">
                    {project.path}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

export { CommandPalette };
