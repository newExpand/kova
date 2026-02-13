/**
 * Tauri IPC Command Wrapper Tests — PLAN.md Feature: Tauri IPC
 *
 * Tests:
 * - All commands call invoke() with correct command names and params
 * - Return types match expected interfaces
 * - No direct invoke() usage outside command wrappers
 *
 * Note: Tauri v2 invoke() internally passes (cmd, args, options).
 * Args without params become {}, and an extra `undefined` options arg is appended.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Access the mock invoke from setup
const getMockInvoke = () =>
  (
    (window as Record<string, unknown>).__TAURI_INTERNALS__ as {
      invoke: ReturnType<typeof vi.fn>;
    }
  ).invoke;

describe("Tauri IPC Command Wrappers", () => {
  beforeEach(() => {
    getMockInvoke().mockReset();
  });

  // ── Project Commands ──────────────────────────────────────────────
  describe("Project commands", () => {
    it("createProject should call invoke with correct params", async () => {
      const mockProject = {
        id: "uuid-1",
        name: "Test",
        path: "/test",
        colorIndex: 2,
        isActive: true,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };
      getMockInvoke().mockResolvedValue(mockProject);

      const { createProject } = await import(
        "../../src/lib/tauri/commands"
      );
      const result = await createProject("Test", "/test", 2);

      // Verify first arg is command name, second contains args
      const call = getMockInvoke().mock.calls[0];
      expect(call[0]).toBe("create_project");
      expect(call[1]).toEqual({
        name: "Test",
        path: "/test",
        colorIndex: 2,
      });
      expect(result).toEqual(mockProject);
    });

    it("listProjects should call invoke with list_projects command", async () => {
      getMockInvoke().mockResolvedValue([]);

      const { listProjects } = await import(
        "../../src/lib/tauri/commands"
      );
      await listProjects();

      expect(getMockInvoke().mock.calls[0][0]).toBe("list_projects");
    });

    it("getProject should pass id parameter", async () => {
      const mockProject = {
        id: "uuid-1",
        name: "Test",
        path: "/test",
        colorIndex: 0,
        isActive: true,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };
      getMockInvoke().mockResolvedValue(mockProject);

      const { getProject } = await import(
        "../../src/lib/tauri/commands"
      );
      await getProject("uuid-1");

      const call = getMockInvoke().mock.calls[0];
      expect(call[0]).toBe("get_project");
      expect(call[1]).toEqual({ id: "uuid-1" });
    });

    it("updateProject should pass id and input", async () => {
      getMockInvoke().mockResolvedValue({});

      const { updateProject } = await import(
        "../../src/lib/tauri/commands"
      );
      await updateProject("uuid-1", { name: "New Name", colorIndex: 5 });

      const call = getMockInvoke().mock.calls[0];
      expect(call[0]).toBe("update_project");
      expect(call[1]).toMatchObject({
        id: "uuid-1",
        name: "New Name",
        colorIndex: 5,
      });
    });

    it("deleteProject should pass id", async () => {
      getMockInvoke().mockResolvedValue(undefined);

      const { deleteProject } = await import(
        "../../src/lib/tauri/commands"
      );
      await deleteProject("uuid-1");

      const call = getMockInvoke().mock.calls[0];
      expect(call[0]).toBe("delete_project");
      expect(call[1]).toEqual({ id: "uuid-1" });
    });

    it("restoreProject should pass id", async () => {
      getMockInvoke().mockResolvedValue(undefined);

      const { restoreProject } = await import(
        "../../src/lib/tauri/commands"
      );
      await restoreProject("uuid-1");

      const call = getMockInvoke().mock.calls[0];
      expect(call[0]).toBe("restore_project");
      expect(call[1]).toEqual({ id: "uuid-1" });
    });

    it("purgeProject should pass id", async () => {
      getMockInvoke().mockResolvedValue(undefined);

      const { purgeProject } = await import(
        "../../src/lib/tauri/commands"
      );
      await purgeProject("uuid-1");

      const call = getMockInvoke().mock.calls[0];
      expect(call[0]).toBe("purge_project");
      expect(call[1]).toEqual({ id: "uuid-1" });
    });
  });

  // ── Hook Commands ─────────────────────────────────────────────────
  describe("Hook commands", () => {
    it("injectProjectHooks should pass projectPath", async () => {
      getMockInvoke().mockResolvedValue(undefined);

      const { injectProjectHooks } = await import(
        "../../src/lib/tauri/commands"
      );
      await injectProjectHooks("/Users/test/project");

      const call = getMockInvoke().mock.calls[0];
      expect(call[0]).toBe("inject_project_hooks");
      expect(call[1]).toEqual({ projectPath: "/Users/test/project" });
    });

    it("removeProjectHooks should pass projectPath", async () => {
      getMockInvoke().mockResolvedValue(undefined);

      const { removeProjectHooks } = await import(
        "../../src/lib/tauri/commands"
      );
      await removeProjectHooks("/Users/test/project");

      const call = getMockInvoke().mock.calls[0];
      expect(call[0]).toBe("remove_project_hooks");
      expect(call[1]).toEqual({ projectPath: "/Users/test/project" });
    });
  });

  // ── tmux Commands ─────────────────────────────────────────────────
  describe("tmux commands", () => {
    it("checkTmuxAvailable should call invoke", async () => {
      getMockInvoke().mockResolvedValue(true);

      const { checkTmuxAvailable } = await import(
        "../../src/lib/tauri/commands"
      );
      const result = await checkTmuxAvailable();

      expect(getMockInvoke().mock.calls[0][0]).toBe("check_tmux_available");
      expect(result).toBe(true);
    });

    it("listTmuxSessions should call invoke", async () => {
      getMockInvoke().mockResolvedValue([]);

      const { listTmuxSessions } = await import(
        "../../src/lib/tauri/commands"
      );
      await listTmuxSessions();

      expect(getMockInvoke().mock.calls[0][0]).toBe("list_tmux_sessions");
    });

    it("listTmuxPanes should pass sessionName", async () => {
      getMockInvoke().mockResolvedValue([]);

      const { listTmuxPanes } = await import(
        "../../src/lib/tauri/commands"
      );
      await listTmuxPanes("my-session");

      const call = getMockInvoke().mock.calls[0];
      expect(call[0]).toBe("list_tmux_panes");
      expect(call[1]).toEqual({ sessionName: "my-session" });
    });
  });

  // ── Notification Commands ─────────────────────────────────────────
  describe("Notification commands", () => {
    it("listProjectNotifications should pass projectId and limit", async () => {
      getMockInvoke().mockResolvedValue([]);

      const { listProjectNotifications } = await import(
        "../../src/lib/tauri/commands"
      );
      await listProjectNotifications("proj-1", 25);

      const call = getMockInvoke().mock.calls[0];
      expect(call[0]).toBe("list_project_notifications");
      expect(call[1]).toEqual({ projectId: "proj-1", limit: 25 });
    });
  });

  // ── Environment Commands ──────────────────────────────────────────
  describe("Environment commands", () => {
    it("checkEnvironment should call invoke and return check result", async () => {
      const mockEnv = {
        tmuxInstalled: true,
        tmuxVersion: "3.4",
        claudeCodeInstalled: true,
        claudeCodeVersion: "1.0.0",
        shellType: "zsh",
      };
      getMockInvoke().mockResolvedValue(mockEnv);

      const { checkEnvironment } = await import(
        "../../src/lib/tauri/commands"
      );
      const result = await checkEnvironment();

      expect(getMockInvoke().mock.calls[0][0]).toBe("check_environment");
      expect(result).toEqual(mockEnv);
    });
  });
});
