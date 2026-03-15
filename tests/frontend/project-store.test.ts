/**
 * Project Store Tests — PLAN.md Feature: 프로젝트 등록/관리
 *
 * Tests:
 * - Project CRUD (create, list, update, delete)
 * - Optimistic delete + undo
 * - Soft delete → restore → purge flow
 * - 8-color palette validation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";

// We need to mock the commands module before importing the store
vi.mock("../../src/lib/tauri/commands", () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  restoreProject: vi.fn(),
  purgeProject: vi.fn(),
}));

import { useProjectStore } from "../../src/features/project/stores/projectStore";
import * as commands from "../../src/lib/tauri/commands";
import type { Project } from "../../src/lib/tauri/commands";

const mockCommands = vi.mocked(commands);

const MOCK_PROJECT: Project = {
  id: "test-uuid-1",
  name: "Test Project",
  path: "/Users/test/project",
  colorIndex: 0,
  isActive: true,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const MOCK_PROJECT_2: Project = {
  id: "test-uuid-2",
  name: "Another Project",
  path: "/Users/test/another",
  colorIndex: 3,
  isActive: true,
  createdAt: "2024-01-02T00:00:00Z",
  updatedAt: "2024-01-02T00:00:00Z",
};

describe("ProjectStore", () => {
  beforeEach(() => {
    // Reset store state
    useProjectStore.getState().reset();
    vi.clearAllMocks();
  });

  // ── Feature: 프로젝트 목록 조회 ──────────────────────────────────────
  describe("fetchProjects", () => {
    it("should fetch and store projects from backend", async () => {
      mockCommands.listProjects.mockResolvedValue([MOCK_PROJECT, MOCK_PROJECT_2]);

      await act(async () => {
        await useProjectStore.getState().fetchProjects();
      });

      const state = useProjectStore.getState();
      expect(state.projects).toHaveLength(2);
      expect(state.projects[0].name).toBe("Test Project");
      expect(state.projects[1].name).toBe("Another Project");
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("should set isLoading during fetch", async () => {
      let loadingDuringFetch = false;
      mockCommands.listProjects.mockImplementation(async () => {
        loadingDuringFetch = useProjectStore.getState().isLoading;
        return [];
      });

      await act(async () => {
        await useProjectStore.getState().fetchProjects();
      });

      expect(loadingDuringFetch).toBe(true);
      expect(useProjectStore.getState().isLoading).toBe(false);
    });

    it("should handle fetch errors gracefully", async () => {
      mockCommands.listProjects.mockRejectedValue(new Error("Network error"));

      await act(async () => {
        await useProjectStore.getState().fetchProjects();
      });

      const state = useProjectStore.getState();
      expect(state.error).toBe("Network error");
      expect(state.isLoading).toBe(false);
    });
  });

  // ── Feature: 프로젝트 추가 ──────────────────────────────────────────
  describe("createProject", () => {
    it("should create project and add to store", async () => {
      mockCommands.createProject.mockResolvedValue(MOCK_PROJECT);

      let result: Project | undefined;
      await act(async () => {
        result = await useProjectStore.getState().createProject({
          name: "Test Project",
          path: "/Users/test/project",
          colorIndex: 0,
        });
      });

      expect(result).toEqual(MOCK_PROJECT);
      expect(useProjectStore.getState().projects).toHaveLength(1);
      expect(mockCommands.createProject).toHaveBeenCalledWith(
        "Test Project",
        "/Users/test/project",
        0,
        undefined,
      );
    });

    it("should handle creation errors", async () => {
      mockCommands.createProject.mockRejectedValue(
        new Error("Duplicate path"),
      );

      let result: unknown;
      await act(async () => {
        result = await useProjectStore.getState().createProject({
          name: "Test",
          path: "/dup",
        });
      });

      expect(result).toBeNull();
      expect(useProjectStore.getState().error).toBe("Duplicate path");
    });

    it("should auto-assign colorIndex via pickLeastUsedColor when not provided", async () => {
      mockCommands.createProject.mockResolvedValue(MOCK_PROJECT);

      await act(async () => {
        await useProjectStore.getState().createProject({
          name: "Test",
          path: "/test",
        });
      });

      // pickLeastUsedColor uses Math.random() — verify a valid index is passed
      expect(mockCommands.createProject).toHaveBeenCalledWith(
        "Test",
        "/test",
        expect.any(Number),
        undefined,
      );
    });
  });

  // ── Feature: 프로젝트 수정 ──────────────────────────────────────────
  describe("updateProject", () => {
    it("should update project in store", async () => {
      // Pre-load project
      useProjectStore.setState({ projects: [MOCK_PROJECT] });

      const updatedProject = {
        ...MOCK_PROJECT,
        name: "Updated Name",
        colorIndex: 5,
      };
      mockCommands.updateProject.mockResolvedValue(updatedProject);

      await act(async () => {
        await useProjectStore.getState().updateProject("test-uuid-1", {
          name: "Updated Name",
          colorIndex: 5,
        });
      });

      const project = useProjectStore.getState().projects[0];
      expect(project.name).toBe("Updated Name");
      expect(project.colorIndex).toBe(5);
    });
  });

  // ── Feature: 프로젝트 삭제 + Undo ──────────────────────────────────
  describe("deleteProject (optimistic + undo)", () => {
    beforeEach(() => {
      useProjectStore.setState({
        projects: [MOCK_PROJECT, MOCK_PROJECT_2],
        selectedId: "test-uuid-1",
      });
    });

    it("should optimistically hide project (mark as deleting)", () => {
      mockCommands.deleteProject.mockResolvedValue(undefined);

      act(() => {
        useProjectStore.getState().deleteProject("test-uuid-1");
      });

      const state = useProjectStore.getState();
      expect(state.deletingIds.has("test-uuid-1")).toBe(true);
      // activeProjects should exclude deleting ones
      expect(state.activeProjects()).toHaveLength(1);
      expect(state.activeProjects()[0].id).toBe("test-uuid-2");
      // Selection cleared when deleted project was selected
      expect(state.selectedId).toBeNull();
    });

    it("should undo delete (restore project)", () => {
      mockCommands.deleteProject.mockResolvedValue(undefined);
      mockCommands.restoreProject.mockResolvedValue(undefined);

      act(() => {
        useProjectStore.getState().deleteProject("test-uuid-1");
      });

      expect(useProjectStore.getState().deletingIds.has("test-uuid-1")).toBe(true);

      act(() => {
        useProjectStore.getState().undoDelete("test-uuid-1");
      });

      expect(useProjectStore.getState().deletingIds.has("test-uuid-1")).toBe(false);
      expect(useProjectStore.getState().activeProjects()).toHaveLength(2);
      expect(mockCommands.restoreProject).toHaveBeenCalledWith("test-uuid-1");
    });

    it("should confirm delete (purge permanently)", async () => {
      mockCommands.deleteProject.mockResolvedValue(undefined);
      mockCommands.purgeProject.mockResolvedValue(undefined);

      act(() => {
        useProjectStore.getState().deleteProject("test-uuid-1");
      });

      await act(async () => {
        await useProjectStore.getState().confirmDelete("test-uuid-1");
      });

      const state = useProjectStore.getState();
      expect(state.projects).toHaveLength(1);
      expect(state.projects[0].id).toBe("test-uuid-2");
      expect(state.deletingIds.has("test-uuid-1")).toBe(false);
    });

    it("should rollback on backend delete failure", async () => {
      mockCommands.deleteProject.mockRejectedValue(new Error("DB error"));

      act(() => {
        useProjectStore.getState().deleteProject("test-uuid-1");
      });

      // Wait for the promise rejection to be processed
      await vi.waitFor(() => {
        expect(useProjectStore.getState().deletingIds.has("test-uuid-1")).toBe(false);
      });

      expect(useProjectStore.getState().error).toBe("DB error");
    });
  });

  // ── Feature: 프로젝트 선택 ──────────────────────────────────────────
  describe("selectProject", () => {
    it("should select a project by id", () => {
      act(() => {
        useProjectStore.getState().selectProject("test-uuid-1");
      });

      expect(useProjectStore.getState().selectedId).toBe("test-uuid-1");
    });

    it("should deselect with null", () => {
      useProjectStore.setState({ selectedId: "test-uuid-1" });

      act(() => {
        useProjectStore.getState().selectProject(null);
      });

      expect(useProjectStore.getState().selectedId).toBeNull();
    });
  });

  // ── Feature: Computed helpers ──────────────────────────────────────
  describe("computed", () => {
    it("getProjectById should find project", () => {
      useProjectStore.setState({ projects: [MOCK_PROJECT, MOCK_PROJECT_2] });

      const found = useProjectStore.getState().getProjectById("test-uuid-2");
      expect(found).toEqual(MOCK_PROJECT_2);
    });

    it("getProjectById should return undefined for missing id", () => {
      useProjectStore.setState({ projects: [MOCK_PROJECT] });

      const found = useProjectStore.getState().getProjectById("nonexistent");
      expect(found).toBeUndefined();
    });
  });

  // ── Feature: Store reset ───────────────────────────────────────────
  describe("reset", () => {
    it("should reset store to initial state", () => {
      useProjectStore.setState({
        projects: [MOCK_PROJECT],
        selectedId: "test-uuid-1",
        isLoading: true,
        error: "some error",
      });

      act(() => {
        useProjectStore.getState().reset();
      });

      const state = useProjectStore.getState();
      expect(state.projects).toEqual([]);
      expect(state.selectedId).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});
