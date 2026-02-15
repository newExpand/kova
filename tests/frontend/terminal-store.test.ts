/**
 * Terminal Store Tests — Per-project Terminal Pool
 *
 * Tests:
 * - Per-project session name management
 * - Per-project status transitions (idle → connecting → connected → disconnected)
 * - Per-project error handling
 * - Reset individual project vs reset all
 * - getTerminal fallback for unknown projects
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useTerminalStore } from "../../src/features/terminal/stores/terminalStore";

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";

describe("TerminalStore", () => {
  beforeEach(() => {
    act(() => {
      useTerminalStore.getState().resetAll();
    });
  });

  // ── getTerminal fallback ──────────────────────────────────────────
  describe("getTerminal", () => {
    it("should return default state for unknown projectId", () => {
      const terminal = useTerminalStore.getState().getTerminal("unknown");
      expect(terminal.sessionName).toBeNull();
      expect(terminal.status).toBe("idle");
      expect(terminal.error).toBeNull();
    });
  });

  // ── Session Management ───────────────────────────────────────────
  describe("setSession", () => {
    it("should set session name and clear error for a specific project", () => {
      // Start with an error state
      act(() => {
        useTerminalStore.getState().setError(PROJECT_A, "previous error");
      });

      act(() => {
        useTerminalStore.getState().setSession(PROJECT_A, "my-project");
      });

      const terminal = useTerminalStore.getState().getTerminal(PROJECT_A);
      expect(terminal.sessionName).toBe("my-project");
      expect(terminal.error).toBeNull();
    });

    it("should not affect other projects", () => {
      act(() => {
        useTerminalStore.getState().setSession(PROJECT_A, "session-a");
        useTerminalStore.getState().setSession(PROJECT_B, "session-b");
      });

      expect(useTerminalStore.getState().getTerminal(PROJECT_A).sessionName).toBe("session-a");
      expect(useTerminalStore.getState().getTerminal(PROJECT_B).sessionName).toBe("session-b");
    });
  });

  // ── Status Transitions ──────────────────────────────────────────
  describe("setStatus", () => {
    it("should transition from idle to connecting", () => {
      act(() => {
        useTerminalStore.getState().setStatus(PROJECT_A, "connecting");
      });

      expect(useTerminalStore.getState().getTerminal(PROJECT_A).status).toBe("connecting");
    });

    it("should transition from connecting to connected", () => {
      act(() => {
        useTerminalStore.getState().setStatus(PROJECT_A, "connecting");
        useTerminalStore.getState().setStatus(PROJECT_A, "connected");
      });

      expect(useTerminalStore.getState().getTerminal(PROJECT_A).status).toBe("connected");
    });

    it("should transition to disconnected", () => {
      act(() => {
        useTerminalStore.getState().setStatus(PROJECT_A, "connected");
        useTerminalStore.getState().setStatus(PROJECT_A, "disconnected");
      });

      expect(useTerminalStore.getState().getTerminal(PROJECT_A).status).toBe("disconnected");
    });

    it("should not affect other projects", () => {
      act(() => {
        useTerminalStore.getState().setStatus(PROJECT_A, "connected");
        useTerminalStore.getState().setStatus(PROJECT_B, "connecting");
      });

      expect(useTerminalStore.getState().getTerminal(PROJECT_A).status).toBe("connected");
      expect(useTerminalStore.getState().getTerminal(PROJECT_B).status).toBe("connecting");
    });
  });

  // ── Error Handling ──────────────────────────────────────────────
  describe("setError", () => {
    it("should set error and status to error for a specific project", () => {
      act(() => {
        useTerminalStore.getState().setError(PROJECT_A, "Connection refused");
      });

      const terminal = useTerminalStore.getState().getTerminal(PROJECT_A);
      expect(terminal.error).toBe("Connection refused");
      expect(terminal.status).toBe("error");
    });

    it("should not affect other projects", () => {
      act(() => {
        useTerminalStore.getState().setStatus(PROJECT_B, "connected");
        useTerminalStore.getState().setError(PROJECT_A, "Connection refused");
      });

      expect(useTerminalStore.getState().getTerminal(PROJECT_B).status).toBe("connected");
      expect(useTerminalStore.getState().getTerminal(PROJECT_B).error).toBeNull();
    });
  });

  // ── Reset ───────────────────────────────────────────────────────
  describe("resetTerminal", () => {
    it("should reset only the specified project", () => {
      act(() => {
        useTerminalStore.getState().setSession(PROJECT_A, "session-a");
        useTerminalStore.getState().setStatus(PROJECT_A, "connected");
        useTerminalStore.getState().setSession(PROJECT_B, "session-b");
        useTerminalStore.getState().setStatus(PROJECT_B, "connected");
      });

      act(() => {
        useTerminalStore.getState().resetTerminal(PROJECT_A);
      });

      // A should be back to defaults
      const termA = useTerminalStore.getState().getTerminal(PROJECT_A);
      expect(termA.sessionName).toBeNull();
      expect(termA.status).toBe("idle");
      expect(termA.error).toBeNull();

      // B should be untouched
      const termB = useTerminalStore.getState().getTerminal(PROJECT_B);
      expect(termB.sessionName).toBe("session-b");
      expect(termB.status).toBe("connected");
    });
  });

  describe("resetAll", () => {
    it("should reset all projects to initial state", () => {
      act(() => {
        useTerminalStore.getState().setSession(PROJECT_A, "session-a");
        useTerminalStore.getState().setSession(PROJECT_B, "session-b");
      });

      act(() => {
        useTerminalStore.getState().resetAll();
      });

      expect(useTerminalStore.getState().terminals).toEqual({});
      expect(useTerminalStore.getState().getTerminal(PROJECT_A).status).toBe("idle");
      expect(useTerminalStore.getState().getTerminal(PROJECT_B).status).toBe("idle");
    });
  });

  // ── Selector isolation (no unnecessary re-renders) ──────────────
  describe("selector isolation", () => {
    it("status selector should not be affected by session changes in same project", () => {
      act(() => {
        useTerminalStore.getState().setStatus(PROJECT_A, "connected");
      });
      const statusBefore = useTerminalStore.getState().getTerminal(PROJECT_A).status;

      act(() => {
        useTerminalStore.getState().setSession(PROJECT_A, "new-session");
      });

      expect(useTerminalStore.getState().getTerminal(PROJECT_A).status).toBe(statusBefore);
    });

    it("project A changes should not affect project B getTerminal result", () => {
      act(() => {
        useTerminalStore.getState().setStatus(PROJECT_B, "connected");
      });

      act(() => {
        useTerminalStore.getState().setError(PROJECT_A, "some error");
      });

      const termB = useTerminalStore.getState().getTerminal(PROJECT_B);
      expect(termB.status).toBe("connected");
      expect(termB.error).toBeNull();
    });
  });
});
