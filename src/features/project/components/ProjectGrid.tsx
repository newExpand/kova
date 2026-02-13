import { useState, useCallback } from "react";
import type { Project, UpdateProjectInput } from "../types";
import { ProjectCard } from "./ProjectCard";
import { ProjectEditForm } from "./ProjectEditForm";
import { UndoToast } from "../../../components/ui/undo-toast";

interface ProjectGridProps {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUndoDelete: (id: string) => void;
  onConfirmDelete: (id: string) => Promise<void>;
  onUpdate: (id: string, input: UpdateProjectInput) => Promise<void>;
}

function ProjectGrid({
  projects,
  selectedId,
  onSelect,
  onDelete,
  onUndoDelete,
  onConfirmDelete,
  onUpdate,
}: ProjectGridProps) {
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const handleDelete = useCallback(
    (id: string) => {
      const project = projects.find((p) => p.id === id);
      if (!project) return;
      setDeletingProject({ id, name: project.name });
      onDelete(id);
    },
    [projects, onDelete],
  );

  const handleUndoDismiss = useCallback(() => {
    if (deletingProject) {
      onConfirmDelete(deletingProject.id);
      setDeletingProject(null);
    }
  }, [deletingProject, onConfirmDelete]);

  const handleUndo = useCallback(() => {
    if (deletingProject) {
      onUndoDelete(deletingProject.id);
      setDeletingProject(null);
    }
  }, [deletingProject, onUndoDelete]);

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-sm text-text-muted">No projects yet</p>
        <p className="mt-1 text-xs text-text-muted">
          Create your first project to get started
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            isSelected={selectedId === project.id}
            onSelect={onSelect}
            onEdit={setEditingProject}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {editingProject && (
        <ProjectEditForm
          project={editingProject}
          open={!!editingProject}
          onOpenChange={(open) => {
            if (!open) setEditingProject(null);
          }}
          onSave={onUpdate}
        />
      )}

      {deletingProject && (
        <UndoToast
          message={`"${deletingProject.name}" deleted`}
          onUndo={handleUndo}
          onDismiss={handleUndoDismiss}
        />
      )}
    </>
  );
}

export { ProjectGrid };
