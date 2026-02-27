/**
 * tmux Store Tests — Session ownership tracking
 *
 * Tests:
 * - Session list fetch (with ownership info)
 * - Pane list fetch
 * - Session selection triggers pane fetch
 * - tmux availability check
 * - Empty states (no tmux server)
 * - Register/unregister session
 * - Project vs external session filtering
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";

vi.mock("../../src/lib/tauri/commands", () => ({
  listTmuxSessionsWithOwnership: vi.fn(),
  listTmuxPanes: vi.fn(),
  checkTmuxAvailable: vi.fn(),
  registerTmuxSession: vi.fn(),
  unregisterTmuxSession: vi.fn(),
}));

import { useTmuxStore } from "../../src/features/tmux/stores/tmuxStore";
import * as commands from "../../src/lib/tauri/commands";
import type { SessionInfo, TmuxPane } from "../../src/lib/tauri/commands";

const mockCommands = vi.mocked(commands);

const MOCK_APP_SESSION: SessionInfo = {
  name: "flow-orche-mvp",
  windows: 3,
  created: "1706000000",
  attached: true,
  isAppSession: true,
  projectId: "proj-1",
};

const MOCK_EXTERNAL_SESSION: SessionInfo = {
  name: "external-session",
  windows: 1,
  created: "1706000001",
  attached: false,
  isAppSession: false,
  projectId: null,
};

const MOCK_OTHER_PROJECT_SESSION: SessionInfo = {
  name: "other-project",
  windows: 2,
  created: "1706000002",
  attached: false,
  isAppSession: true,
  projectId: "proj-2",
};

const MOCK_PANE: TmuxPane = {
  sessionName: "flow-orche-mvp",
  windowIndex: 0,
  paneIndex: 0,
  paneTitle: "team-lead",
  paneCurrentCommand: "claude",
  paneActive: true,
};

const MOCK_PANE_2: TmuxPane = {
  sessionName: "flow-orche-mvp",
  windowIndex: 0,
  paneIndex: 1,
  paneTitle: "agent-1",
  paneCurrentCommand: "claude",
  paneActive: false,
};

describe("TmuxStore", () => {
  beforeEach(() => {
    useTmuxStore.getState().reset();
    vi.clearAllMocks();
  });

  // ── Feature: tmux 사용 가능 여부 체크 ──────────────────────────────
  describe("checkAvailability", () => {
    it("should check tmux availability", async () => {
      mockCommands.checkTmuxAvailable.mockResolvedValue(true);

      await act(async () => {
        await useTmuxStore.getState().checkAvailability();
      });

      expect(useTmuxStore.getState().isAvailable).toBe(true);
    });

    it("should handle tmux not installed", async () => {
      mockCommands.checkTmuxAvailable.mockResolvedValue(false);

      await act(async () => {
        await useTmuxStore.getState().checkAvailability();
      });

      expect(useTmuxStore.getState().isAvailable).toBe(false);
    });

    it("should handle check errors", async () => {
      mockCommands.checkTmuxAvailable.mockRejectedValue(
        new Error("Command failed"),
      );

      await act(async () => {
        await useTmuxStore.getState().checkAvailability();
      });

      expect(useTmuxStore.getState().isAvailable).toBe(false);
      expect(useTmuxStore.getState().error).toBe("Command failed");
    });
  });

  // ── Feature: 세션 목록 조회 (ownership 포함) ────────────────────────
  describe("fetchSessions", () => {
    it("should fetch sessions with ownership info", async () => {
      mockCommands.listTmuxSessionsWithOwnership.mockResolvedValue([
        MOCK_APP_SESSION,
        MOCK_EXTERNAL_SESSION,
      ]);

      await act(async () => {
        await useTmuxStore.getState().fetchSessions();
      });

      const state = useTmuxStore.getState();
      expect(state.sessions).toHaveLength(2);
      expect(state.sessions[0].isAppSession).toBe(true);
      expect(state.sessions[0].projectId).toBe("proj-1");
      expect(state.sessions[1].isAppSession).toBe(false);
      expect(state.sessions[1].projectId).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it("should handle empty session list (no tmux server)", async () => {
      mockCommands.listTmuxSessionsWithOwnership.mockResolvedValue([]);

      await act(async () => {
        await useTmuxStore.getState().fetchSessions();
      });

      expect(useTmuxStore.getState().sessions).toEqual([]);
      expect(useTmuxStore.getState().isLoading).toBe(false);
    });

    it("should handle fetch error", async () => {
      mockCommands.listTmuxSessionsWithOwnership.mockRejectedValue(
        new Error("tmux error"),
      );

      await act(async () => {
        await useTmuxStore.getState().fetchSessions();
      });

      expect(useTmuxStore.getState().error).toBe("tmux error");
      expect(useTmuxStore.getState().isLoading).toBe(false);
    });
  });

  // ── Feature: 세션 등록/해제 ─────────────────────────────────────────
  describe("registerSession", () => {
    it("should register a session and update store from response", async () => {
      mockCommands.registerTmuxSession.mockResolvedValue([MOCK_APP_SESSION]);

      await act(async () => {
        await useTmuxStore.getState().registerSession("proj-1", "new-session");
      });

      expect(mockCommands.registerTmuxSession).toHaveBeenCalledWith(
        "proj-1",
        "new-session",
      );
      // No separate fetchSessions call — sessions come from register response
      expect(mockCommands.listTmuxSessionsWithOwnership).not.toHaveBeenCalled();
      expect(useTmuxStore.getState().sessions).toEqual([MOCK_APP_SESSION]);
    });
  });

  describe("unregisterSession", () => {
    it("should unregister a session and update store from response", async () => {
      mockCommands.unregisterTmuxSession.mockResolvedValue([]);

      await act(async () => {
        await useTmuxStore.getState().unregisterSession("old-session");
      });

      expect(mockCommands.unregisterTmuxSession).toHaveBeenCalledWith(
        "old-session",
      );
      // No separate fetchSessions call — sessions come from unregister response
      expect(mockCommands.listTmuxSessionsWithOwnership).not.toHaveBeenCalled();
      expect(useTmuxStore.getState().sessions).toEqual([]);
    });
  });

  // ── Feature: Pane 목록 조회 ───────────────────────────────────────
  describe("fetchPanes", () => {
    it("should fetch panes for a session", async () => {
      mockCommands.listTmuxPanes.mockResolvedValue([MOCK_PANE, MOCK_PANE_2]);

      await act(async () => {
        await useTmuxStore.getState().fetchPanes("flow-orche-mvp");
      });

      const state = useTmuxStore.getState();
      const panes = state.panes["flow-orche-mvp"];
      expect(panes).toHaveLength(2);
      expect(panes[0].paneTitle).toBe("team-lead");
      expect(panes[0].paneCurrentCommand).toBe("claude");
      expect(panes[0].paneActive).toBe(true);
      expect(panes[1].paneTitle).toBe("agent-1");
      expect(panes[1].paneActive).toBe(false);
    });

    it("should store panes per session name", async () => {
      mockCommands.listTmuxPanes.mockResolvedValueOnce([MOCK_PANE]);
      mockCommands.listTmuxPanes.mockResolvedValueOnce([]);

      await act(async () => {
        await useTmuxStore.getState().fetchPanes("flow-orche-mvp");
      });
      await act(async () => {
        await useTmuxStore.getState().fetchPanes("test-session");
      });

      const state = useTmuxStore.getState();
      expect(state.panes["flow-orche-mvp"]).toHaveLength(1);
      expect(state.panes["test-session"]).toEqual([]);
    });
  });

  // ── Feature: 세션 선택 → Pane 자동 조회 ───────────────────────────
  describe("selectSession", () => {
    it("should select a session and auto-fetch panes", async () => {
      mockCommands.listTmuxPanes.mockResolvedValue([MOCK_PANE]);

      act(() => {
        useTmuxStore.getState().selectSession("flow-orche-mvp");
      });

      expect(useTmuxStore.getState().selectedSession).toBe("flow-orche-mvp");

      // Wait for pane fetch
      await vi.waitFor(() => {
        expect(mockCommands.listTmuxPanes).toHaveBeenCalledWith(
          "flow-orche-mvp",
        );
      });
    });

    it("should deselect with null", () => {
      useTmuxStore.setState({ selectedSession: "flow-orche-mvp" });

      act(() => {
        useTmuxStore.getState().selectSession(null);
      });

      expect(useTmuxStore.getState().selectedSession).toBeNull();
    });

    it("should not re-fetch panes if already cached", () => {
      useTmuxStore.setState({
        panes: { "flow-orche-mvp": [MOCK_PANE] },
      });

      act(() => {
        useTmuxStore.getState().selectSession("flow-orche-mvp");
      });

      // Should not call listTmuxPanes since panes are already cached
      expect(mockCommands.listTmuxPanes).not.toHaveBeenCalled();
    });
  });

  // ── Feature: 세션 ownership 필터링 ──────────────────────────────────
  describe("session filtering", () => {
    it("should distinguish app and external sessions by ownership", async () => {
      mockCommands.listTmuxSessionsWithOwnership.mockResolvedValue([
        MOCK_APP_SESSION,
        MOCK_EXTERNAL_SESSION,
        MOCK_OTHER_PROJECT_SESSION,
      ]);

      await act(async () => {
        await useTmuxStore.getState().fetchSessions();
      });

      const { sessions } = useTmuxStore.getState();
      const projectSessions = sessions.filter(
        (s) => s.isAppSession && s.projectId === "proj-1",
      );
      const externalSessions = sessions.filter(
        (s) => !s.isAppSession || s.projectId !== "proj-1",
      );

      expect(projectSessions).toHaveLength(1);
      expect(projectSessions[0].name).toBe("flow-orche-mvp");
      expect(externalSessions).toHaveLength(2);
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────
  describe("reset", () => {
    it("should reset to initial state", () => {
      useTmuxStore.setState({
        sessions: [MOCK_APP_SESSION],
        selectedSession: "flow-orche-mvp",
        panes: { "flow-orche-mvp": [MOCK_PANE] },
        isAvailable: true,
        isLoading: true,
      });

      act(() => {
        useTmuxStore.getState().reset();
      });

      const state = useTmuxStore.getState();
      expect(state.sessions).toEqual([]);
      expect(state.selectedSession).toBeNull();
      expect(state.panes).toEqual({});
      expect(state.isAvailable).toBeNull();
      expect(state.isLoading).toBe(false);
    });
  });
});
