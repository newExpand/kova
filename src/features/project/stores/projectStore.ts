import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { Project, CreateProjectInput, UpdateProjectInput } from "../types";
import { COLOR_PALETTE } from "../types";
import * as commands from "../../../lib/tauri/commands";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickLeastUsedColor(projects: Project[]): number {
  const total = COLOR_PALETTE.length;
  const counts = new Array<number>(total).fill(0);
  for (const p of projects) {
    if (p.isActive && p.colorIndex >= 0 && p.colorIndex < total) {
      counts[p.colorIndex] = (counts[p.colorIndex] ?? 0) + 1;
    }
  }
  const min = Math.min(...counts);
  const candidates: number[] = [];
  for (let i = 0; i < total; i++) {
    if (counts[i] === min) candidates.push(i);
  }
  return candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ProjectState {
  projects: Project[];
  selectedId: string | null;
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
  deletingIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface ProjectActions {
  // Computed
  getProjectById: (id: string) => Project | undefined;
  activeProjects: () => Project[];

  // Data fetching
  fetchProjects: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project | null>;
  updateProject: (id: string, input: UpdateProjectInput) => Promise<void>;

  // Reorder
  reorderProjects: (orderedProjects: Project[]) => void;

  // Optimistic delete + undo
  deleteProject: (id: string) => void;
  undoDelete: (id: string) => Promise<void>;
  confirmDelete: (id: string) => Promise<void>;

  // Selection
  selectProject: (id: string | null) => void;

  // Reset
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Combined Store Type
// ---------------------------------------------------------------------------

type ProjectStore = ProjectState & ProjectActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: ProjectState = {
  projects: [],
  selectedId: null,
  isLoading: false,
  isCreating: false,
  error: null,
  deletingIds: new Set(),
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useProjectStore = create<ProjectStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // -- Computed --------------------------------------------------------

      getProjectById: (id) => get().projects.find((p) => p.id === id),

      activeProjects: () =>
        get().projects.filter(
          (p) => p.isActive && !get().deletingIds.has(p.id),
        ),

      // -- Data fetching ---------------------------------------------------

      fetchProjects: async () => {
        set({ isLoading: true, error: null }, undefined, "fetchProjects/start");
        try {
          const projects = await commands.listProjects();
          set({ projects, isLoading: false }, undefined, "fetchProjects/success");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set(
            { error: message, isLoading: false },
            undefined,
            "fetchProjects/error",
          );
        }
      },

      createProject: async (input) => {
        set({ isCreating: true, error: null }, undefined, "createProject/start");
        try {
          const colorIndex = input.colorIndex ?? pickLeastUsedColor(get().projects);
          const project = await commands.createProject(
            input.name,
            input.path,
            colorIndex,
            input.agentType,
          );
          set(
            (state) => ({
              projects: [project, ...state.projects],
              isCreating: false,
            }),
            undefined,
            "createProject/success",
          );
          return project;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set(
            { error: message, isCreating: false },
            undefined,
            "createProject/error",
          );
          return null;
        }
      },

      updateProject: async (id, input) => {
        set({ error: null }, undefined, "updateProject/start");
        try {
          const updated = await commands.updateProject(id, input);
          set(
            (state) => ({
              projects: state.projects.map((p) =>
                p.id === id ? updated : p,
              ),
            }),
            undefined,
            "updateProject/success",
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set({ error: message }, undefined, "updateProject/error");
          throw err;
        }
      },

      // -- Reorder ----------------------------------------------------------

      reorderProjects: (orderedProjects) => {
        const previousProjects = get().projects;

        // Preserve projects not in the reordered set (inactive, mid-deletion, etc.)
        const reorderedIds = new Set(orderedProjects.map((p) => p.id));
        const preserved = previousProjects.filter(
          (p) => !reorderedIds.has(p.id),
        );

        set(
          { projects: [...orderedProjects, ...preserved] },
          undefined,
          "reorderProjects",
        );

        // Called once on drop — no debouncing needed
        const ids = orderedProjects.map((p) => p.id);
        commands.reorderProjects(ids).catch(async (err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[ProjectStore] Reorder failed, re-fetching:", message);

          // Re-fetch from server to avoid stale snapshot overwriting concurrent mutations
          try {
            const freshProjects = await commands.listProjects();
            set(
              { projects: freshProjects, error: `Failed to save project order: ${message}` },
              undefined,
              "reorderProjects/rollback",
            );
          } catch {
            // If re-fetch also fails, fall back to stale snapshot as last resort
            set(
              { projects: previousProjects, error: `Failed to save project order: ${message}` },
              undefined,
              "reorderProjects/rollback-stale",
            );
          }
        });
      },

      // -- Optimistic delete + undo ----------------------------------------

      deleteProject: (id) => {
        // Step 1: Mark as deleting (optimistic — hide from UI immediately)
        set(
          (state) => ({
            deletingIds: new Set([...state.deletingIds, id]),
            selectedId: state.selectedId === id ? null : state.selectedId,
          }),
          undefined,
          "deleteProject/optimistic",
        );

        // Step 2: Call backend soft-delete
        commands.deleteProject(id).catch((err) => {
          // Rollback on failure
          const message = err instanceof Error ? err.message : String(err);
          set(
            (state) => {
              const next = new Set(state.deletingIds);
              next.delete(id);
              return { deletingIds: next, error: message };
            },
            undefined,
            "deleteProject/rollback",
          );
        });
      },

      undoDelete: async (id) => {
        // Optimistic: remove from deleting set immediately
        set(
          (state) => {
            const next = new Set(state.deletingIds);
            next.delete(id);
            return { deletingIds: next };
          },
          undefined,
          "undoDelete/optimistic",
        );

        try {
          await commands.restoreProject(id);
        } catch (err) {
          // Rollback: add back to deletingIds on failure
          const message = err instanceof Error ? err.message : String(err);
          set(
            (state) => ({
              deletingIds: new Set([...state.deletingIds, id]),
              error: message,
            }),
            undefined,
            "undoDelete/rollback",
          );
        }
      },

      confirmDelete: async (id) => {
        // Timer expired — actually purge
        try {
          await commands.purgeProject(id);
          set(
            (state) => {
              const next = new Set(state.deletingIds);
              next.delete(id);
              return {
                projects: state.projects.filter((p) => p.id !== id),
                deletingIds: next,
              };
            },
            undefined,
            "confirmDelete/success",
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set(
            (state) => {
              const next = new Set(state.deletingIds);
              next.delete(id);
              return { deletingIds: next, error: message };
            },
            undefined,
            "confirmDelete/error",
          );
        }
      },

      // -- Selection -------------------------------------------------------

      selectProject: (id) =>
        set({ selectedId: id }, undefined, "selectProject"),

      // -- Reset -----------------------------------------------------------

      reset: () => set(initialState, undefined, "reset"),
    }),
    { name: "ProjectStore" },
  ),
);
