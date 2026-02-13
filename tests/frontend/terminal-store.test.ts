/**
 * Terminal Store Tests — Embedded Interactive Terminal
 *
 * Tests:
 * - Session name management
 * - Status transitions (idle → connecting → connected → disconnected)
 * - Error handling
 * - Reset to initial state
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useTerminalStore } from "../../src/features/terminal/stores/terminalStore";

describe("TerminalStore", () => {
  beforeEach(() => {
    act(() => {
      useTerminalStore.getState().reset();
    });
  });

  // ── Session Management ───────────────────────────────────────────
  describe("setSession", () => {
    it("should set session name and clear error", () => {
      // Start with an error state
      useTerminalStore.setState({ error: "previous error" });

      act(() => {
        useTerminalStore.getState().setSession("my-project");
      });

      const state = useTerminalStore.getState();
      expect(state.sessionName).toBe("my-project");
      expect(state.error).toBeNull();
    });
  });

  // ── Status Transitions ──────────────────────────────────────────
  describe("setStatus", () => {
    it("should transition from idle to connecting", () => {
      act(() => {
        useTerminalStore.getState().setStatus("connecting");
      });

      expect(useTerminalStore.getState().status).toBe("connecting");
    });

    it("should transition from connecting to connected", () => {
      useTerminalStore.setState({ status: "connecting" });

      act(() => {
        useTerminalStore.getState().setStatus("connected");
      });

      expect(useTerminalStore.getState().status).toBe("connected");
    });

    it("should transition to disconnected", () => {
      useTerminalStore.setState({ status: "connected" });

      act(() => {
        useTerminalStore.getState().setStatus("disconnected");
      });

      expect(useTerminalStore.getState().status).toBe("disconnected");
    });
  });

  // ── Error Handling ──────────────────────────────────────────────
  describe("setError", () => {
    it("should set error and status to error", () => {
      act(() => {
        useTerminalStore.getState().setError("Connection refused");
      });

      const state = useTerminalStore.getState();
      expect(state.error).toBe("Connection refused");
      expect(state.status).toBe("error");
    });
  });

  // ── Reset ───────────────────────────────────────────────────────
  describe("reset", () => {
    it("should reset to initial state", () => {
      useTerminalStore.setState({
        sessionName: "my-session",
        status: "connected",
        error: "some error",
      });

      act(() => {
        useTerminalStore.getState().reset();
      });

      const state = useTerminalStore.getState();
      expect(state.sessionName).toBeNull();
      expect(state.status).toBe("idle");
      expect(state.error).toBeNull();
    });
  });

  // ── Selector isolation (no unnecessary re-renders) ──────────────
  describe("selector isolation", () => {
    it("status selector should not be affected by session changes", () => {
      // This tests that selecting individual fields prevents unnecessary coupling
      const statusBefore = useTerminalStore.getState().status;

      act(() => {
        useTerminalStore.getState().setSession("new-session");
      });

      expect(useTerminalStore.getState().status).toBe(statusBefore);
    });
  });
});
