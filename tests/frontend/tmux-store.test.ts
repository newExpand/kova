/**
 * tmux Store Tests — PLAN.md Feature: tmux 세션 통합
 *
 * Tests:
 * - Session list fetch
 * - Pane list fetch
 * - Session selection triggers pane fetch
 * - tmux availability check
 * - Empty states (no tmux server)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";

vi.mock("../../src/lib/tauri/commands", () => ({
  listTmuxSessions: vi.fn(),
  listTmuxPanes: vi.fn(),
  checkTmuxAvailable: vi.fn(),
}));

import { useTmuxStore } from "../../src/features/tmux/stores/tmuxStore";
import * as commands from "../../src/lib/tauri/commands";
import type { TmuxSession, TmuxPane } from "../../src/lib/tauri/commands";

const mockCommands = vi.mocked(commands);

const MOCK_SESSION: TmuxSession = {
  name: "flow-orche-mvp",
  windows: 3,
  created: "1706000000",
  attached: true,
};

const MOCK_SESSION_2: TmuxSession = {
  name: "test-session",
  windows: 1,
  created: "1706000001",
  attached: false,
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

  // ── Feature: 세션 목록 조회 ────────────────────────────────────────
  describe("fetchSessions", () => {
    it("should fetch tmux sessions from backend", async () => {
      mockCommands.listTmuxSessions.mockResolvedValue([
        MOCK_SESSION,
        MOCK_SESSION_2,
      ]);

      await act(async () => {
        await useTmuxStore.getState().fetchSessions();
      });

      const state = useTmuxStore.getState();
      expect(state.sessions).toHaveLength(2);
      expect(state.sessions[0].name).toBe("flow-orche-mvp");
      expect(state.sessions[0].attached).toBe(true);
      expect(state.sessions[1].attached).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it("should handle empty session list (no tmux server)", async () => {
      mockCommands.listTmuxSessions.mockResolvedValue([]);

      await act(async () => {
        await useTmuxStore.getState().fetchSessions();
      });

      expect(useTmuxStore.getState().sessions).toEqual([]);
      expect(useTmuxStore.getState().isLoading).toBe(false);
    });

    it("should handle fetch error", async () => {
      mockCommands.listTmuxSessions.mockRejectedValue(
        new Error("tmux error"),
      );

      await act(async () => {
        await useTmuxStore.getState().fetchSessions();
      });

      expect(useTmuxStore.getState().error).toBe("tmux error");
      expect(useTmuxStore.getState().isLoading).toBe(false);
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

  // ── Reset ─────────────────────────────────────────────────────────
  describe("reset", () => {
    it("should reset to initial state", () => {
      useTmuxStore.setState({
        sessions: [MOCK_SESSION],
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
