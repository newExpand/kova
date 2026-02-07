import { useEffect } from 'react';
import { useProjectStore } from '../stores/projectStore';
import type { Project, CreateProjectInput, UpdateProjectInput } from '../types';
import * as commands from '@/lib/tauri/commands';

export function useProjects() {
  const {
    projects,
    isLoading,
    error,
    setProjects,
    setLoading,
    setError,
  } = useProjectStore();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await commands.listProjects();
      setProjects(result as Project[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '프로젝트 목록을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const createProject = async (input: CreateProjectInput) => {
    const tempId = `temp-${Date.now()}`;

    // Optimistic update
    useProjectStore.getState().addProjectOptimistic(input, tempId);

    try {
      const realId = await commands.createProject(input.name, input.path);

      // 실제 프로젝트 정보 가져오기
      const project = await commands.getProject(realId);
      if (project) {
        useProjectStore.getState().confirmOptimistic(tempId, realId, project as Project);
      } else {
        // 생성은 성공했지만 조회 실패 - 전체 리로드
        await loadProjects();
      }
    } catch (err) {
      // Rollback on failure
      useProjectStore.getState().rollbackOptimistic(tempId);
      throw err;
    }
  };

  const updateProject = async (id: string, input: UpdateProjectInput) => {
    // 기존 프로젝트 백업
    const original = useProjectStore.getState().getProjectById(id);
    if (!original) {
      throw new Error('프로젝트를 찾을 수 없습니다.');
    }

    // Optimistic update
    useProjectStore.getState().updateProject(id, input);

    try {
      const updated = await commands.updateProject(id, input);
      useProjectStore.getState().updateProject(id, updated as Project);
    } catch (err) {
      // Rollback
      useProjectStore.getState().updateProject(id, original);
      throw err;
    }
  };

  const deleteProject = async (id: string, onToastShow: (projectName: string) => void) => {
    const project = useProjectStore.getState().getProjectById(id);
    if (!project) {
      throw new Error('프로젝트를 찾을 수 없습니다.');
    }

    // 5초 undo 윈도우 시작
    const confirmDelete = async () => {
      try {
        await commands.deleteProject(id);
      } catch (err) {
        // 실패 시 프로젝트 복원
        useProjectStore.getState().addProject(project);
      }
    };

    useProjectStore.getState().markForDeletion(id, confirmDelete);
    onToastShow(project.name);
  };

  const restoreProject = async (id: string) => {
    try {
      const restored = await commands.restoreProject(id);
      useProjectStore.getState().addProject(restored as Project);
      useProjectStore.getState().cancelDeletion(id);
    } catch (err) {
      throw err;
    }
  };

  return {
    projects,
    isLoading,
    error,
    loadProjects,
    createProject,
    updateProject,
    deleteProject,
    restoreProject,
  };
}
