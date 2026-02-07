import { useCallback, useEffect } from 'react';
import { useProjectStore } from '../stores/projectStore';
import type { CreateProjectInput, UpdateProjectInput } from '../types';
import * as commands from '@/lib/tauri/commands';

export function useProjects() {
  const {
    projects,
    isLoading,
    isCreating,
    isUpdating,
    isDeleting,
    isRestoring,
    error,
    setProjects,
    setLoading,
    setCreating,
    setUpdating,
    setDeleting,
    setRestoring,
    setError,
  } = useProjectStore();

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await commands.listProjects();
      setProjects(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '프로젝트 목록을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError, setProjects]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const createProject = async (input: CreateProjectInput) => {
    const tempId = `temp-${Date.now()}`;

    // Optimistic update
    useProjectStore.getState().addProjectOptimistic(input, tempId);
    setCreating(true);

    try {
      const realId = await commands.createProject(input.name, input.path);

      const project = await commands.getProject(realId);
      if (project) {
        useProjectStore.getState().confirmOptimistic(tempId, realId, project);
      } else {
        await loadProjects();
      }
    } catch (err) {
      useProjectStore.getState().rollbackOptimistic(tempId);
      throw err;
    } finally {
      setCreating(false);
    }
  };

  const updateProject = async (id: string, input: UpdateProjectInput) => {
    const original = useProjectStore.getState().getProjectById(id);
    if (!original) {
      throw new Error('프로젝트를 찾을 수 없습니다.');
    }

    // Optimistic update
    useProjectStore.getState().updateProject(id, input);
    setUpdating(true);

    try {
      const updated = await commands.updateProject(id, input);
      useProjectStore.getState().updateProject(id, updated);
    } catch (err) {
      useProjectStore.getState().updateProject(id, original);
      throw err;
    } finally {
      setUpdating(false);
    }
  };

  const deleteProject = async (id: string, onToastShow: (projectName: string) => void) => {
    const project = useProjectStore.getState().getProjectById(id);
    if (!project) {
      throw new Error('프로젝트를 찾을 수 없습니다.');
    }

    setDeleting(true);

    const confirmDelete = async () => {
      try {
        await commands.deleteProject(id);
      } catch {
        useProjectStore.getState().addProject(project);
      } finally {
        setDeleting(false);
      }
    };

    useProjectStore.getState().markForDeletion(id, confirmDelete);
    onToastShow(project.name);
  };

  const restoreProject = async (id: string) => {
    setRestoring(true);
    try {
      const restored = await commands.restoreProject(id);
      useProjectStore.getState().addProject(restored);
      useProjectStore.getState().cancelDeletion(id);
    } finally {
      setRestoring(false);
    }
  };

  return {
    projects,
    isLoading,
    isCreating,
    isUpdating,
    isDeleting,
    isRestoring,
    error,
    loadProjects,
    createProject,
    updateProject,
    deleteProject,
    restoreProject,
  };
}
