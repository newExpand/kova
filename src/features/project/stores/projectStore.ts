import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Project, CreateProjectInput } from '../types';

// pendingDelete 타이머를 store 외부에서 관리 (devtools 직렬화 문제 방지)
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface ProjectStore {
  // State
  projects: Project[];
  selectedProjectId: string | null;
  isLoading: boolean;
  isCreating: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
  isRestoring: boolean;
  error: string | null;
  pendingDeleteIds: string[]; // undo 대기 중인 프로젝트 ID 목록

  // Computed
  getProjectById: (id: string) => Project | undefined;

  // Actions
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  removeProject: (id: string) => void;
  selectProject: (id: string | null) => void;
  setLoading: (isLoading: boolean) => void;
  setCreating: (isCreating: boolean) => void;
  setUpdating: (isUpdating: boolean) => void;
  setDeleting: (isDeleting: boolean) => void;
  setRestoring: (isRestoring: boolean) => void;
  setError: (error: string | null) => void;

  // Optimistic actions (Story 1.3)
  addProjectOptimistic: (input: CreateProjectInput, tempId: string) => void;
  rollbackOptimistic: (tempId: string) => void;
  confirmOptimistic: (tempId: string, realId: string, project: Project) => void;

  // Delete with undo (Story 1.4)
  markForDeletion: (id: string, onConfirm: () => void) => void;
  cancelDeletion: (id: string) => void;
  confirmDeletion: (id: string) => void;

  // Reset
  reset: () => void;
}

const initialState = {
  projects: [] as Project[],
  selectedProjectId: null as string | null,
  isLoading: false,
  isCreating: false,
  isUpdating: false,
  isDeleting: false,
  isRestoring: false,
  error: null as string | null,
  pendingDeleteIds: [] as string[],
};

export const useProjectStore = create<ProjectStore>()(
  devtools(
    (set, get) => ({
      // State
      ...initialState,

      // Computed
      getProjectById: (id: string) => {
        return get().projects.find((p) => p.id === id);
      },

      // Actions
      setProjects: (projects) => set({ projects }, false, 'setProjects'),

      addProject: (project) =>
        set(
          (state) => ({
            projects: [project, ...state.projects],
          }),
          false,
          'addProject'
        ),

      updateProject: (id, updates) =>
        set(
          (state) => ({
            projects: state.projects.map((p) => (p.id === id ? { ...p, ...updates } : p)),
          }),
          false,
          'updateProject'
        ),

      removeProject: (id) =>
        set(
          (state) => ({
            projects: state.projects.filter((p) => p.id !== id),
          }),
          false,
          'removeProject'
        ),

      selectProject: (id) => set({ selectedProjectId: id }, false, 'selectProject'),

      setLoading: (isLoading) => set({ isLoading }, false, 'setLoading'),

      setCreating: (isCreating) => set({ isCreating }, false, 'setCreating'),

      setUpdating: (isUpdating) => set({ isUpdating }, false, 'setUpdating'),

      setDeleting: (isDeleting) => set({ isDeleting }, false, 'setDeleting'),

      setRestoring: (isRestoring) => set({ isRestoring }, false, 'setRestoring'),

      setError: (error) => set({ error }, false, 'setError'),

      // Optimistic Updates
      addProjectOptimistic: (input, tempId) =>
        set(
          (state) => ({
            projects: [
              {
                id: tempId,
                name: input.name,
                path: input.path,
                colorIndex: state.projects.length % 8,
                accountId: null,
                defaultPrompt: null,
                isActive: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                pathExists: true,
              },
              ...state.projects,
            ],
          }),
          false,
          'addProjectOptimistic'
        ),

      rollbackOptimistic: (tempId) =>
        set(
          (state) => ({
            projects: state.projects.filter((p) => p.id !== tempId),
          }),
          false,
          'rollbackOptimistic'
        ),

      confirmOptimistic: (tempId, realId, project) =>
        set(
          (state) => ({
            projects: state.projects.map((p) => (p.id === tempId ? { ...project, id: realId } : p)),
          }),
          false,
          'confirmOptimistic'
        ),

      // Delete with undo (Story 1.4)
      markForDeletion: (id, onConfirm) =>
        set(
          (state) => {
            const existing = pendingTimers.get(id);
            if (existing) {
              clearTimeout(existing);
            }

            const timer = setTimeout(() => {
              onConfirm();
              get().confirmDeletion(id);
            }, 5000);

            pendingTimers.set(id, timer);

            return {
              projects: state.projects.filter((p) => p.id !== id),
              pendingDeleteIds: [...state.pendingDeleteIds, id],
            };
          },
          false,
          'markForDeletion'
        ),

      cancelDeletion: (id) =>
        set(
          (state) => {
            const timer = pendingTimers.get(id);
            if (timer) {
              clearTimeout(timer);
              pendingTimers.delete(id);
            }
            return {
              pendingDeleteIds: state.pendingDeleteIds.filter((pid) => pid !== id),
            };
          },
          false,
          'cancelDeletion'
        ),

      confirmDeletion: (id) =>
        set(
          (state) => {
            pendingTimers.delete(id);
            return {
              pendingDeleteIds: state.pendingDeleteIds.filter((pid) => pid !== id),
            };
          },
          false,
          'confirmDeletion'
        ),

      // Reset
      reset: () => {
        pendingTimers.forEach((timer) => clearTimeout(timer));
        pendingTimers.clear();
        return set(initialState, false, 'reset');
      },
    }),
    { name: 'ProjectStore' }
  )
);
