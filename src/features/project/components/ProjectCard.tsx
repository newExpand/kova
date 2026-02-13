import type { Project } from "../types";
import { COLOR_PALETTE } from "../types";
import { StatusIndicator } from "./StatusIndicator";
import { cn } from "../../../lib/utils";

interface ProjectCardProps {
  project: Project;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onEdit: (project: Project) => void;
  onDelete: (id: string) => void;
}

function ProjectCard({
  project,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
}: ProjectCardProps) {
  const colorVar = COLOR_PALETTE[project.colorIndex] ?? COLOR_PALETTE[0];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(project.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(project.id);
        }
      }}
      className={cn(
        "group relative flex flex-col rounded-lg border p-4 transition-colors cursor-pointer",
        isSelected
          ? "border-primary bg-surface"
          : "border-border-subtle bg-bg-secondary hover:bg-surface-hover hover:border-border",
      )}
    >
      {/* Color indicator bar */}
      <div
        className="absolute left-0 top-3 h-6 w-1 rounded-r-full"
        style={{ backgroundColor: colorVar }}
      />

      <div className="flex items-start justify-between pl-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-text">
              {project.name}
            </h3>
            <StatusIndicator active={project.isActive} />
          </div>
          <p className="mt-1 truncate text-xs text-text-muted font-mono">
            {project.path}
          </p>
        </div>
      </div>

      {/* Actions (visible on hover) */}
      <div className="mt-3 flex items-center gap-1 pl-3 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(project);
          }}
          className="rounded px-2 py-0.5 text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors"
        >
          Edit
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(project.id);
          }}
          className="rounded px-2 py-0.5 text-xs text-danger hover:bg-bg-tertiary transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export { ProjectCard };
