import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useProjectStore } from "../stores/projectStore";

export function useProjects() {
  const navigate = useNavigate();
  const projects = useProjectStore((s) => s.projects);
  const selectedId = useProjectStore((s) => s.selectedId);
  const isLoading = useProjectStore((s) => s.isLoading);
  const isCreating = useProjectStore((s) => s.isCreating);
  const error = useProjectStore((s) => s.error);
  const deletingIds = useProjectStore((s) => s.deletingIds);

  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const createProject = useProjectStore((s) => s.createProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const undoDelete = useProjectStore((s) => s.undoDelete);
  const confirmDelete = useProjectStore((s) => s.confirmDelete);
  const selectProject = useProjectStore((s) => s.selectProject);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const visibleProjects = projects.filter((p) => !deletingIds.has(p.id));

  const navigateToProject = useCallback(
    (id: string) => {
      selectProject(id);
      navigate(`/projects/${id}`);
    },
    [selectProject, navigate],
  );

  return {
    projects: visibleProjects,
    allProjects: projects,
    selectedId,
    isLoading,
    isCreating,
    error,

    fetchProjects,
    createProject,
    updateProject,
    deleteProject,
    undoDelete,
    confirmDelete,
    selectProject: navigateToProject,
  };
}
