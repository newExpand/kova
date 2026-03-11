/**
 * App Store Tests — 사이드바 접기/펼치기/숨기기
 *
 * Tests:
 * - Sidebar collapsed/expanded toggle
 * - Sidebar hidden toggle (Cmd+B)
 * - Reset state
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useAppStore } from "../../src/stores/appStore";

describe("AppStore", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  describe("sidebar toggle", () => {
    it("should start expanded (not collapsed)", () => {
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });

    it("should toggle sidebar collapsed state", () => {
      act(() => {
        useAppStore.getState().toggleSidebar();
      });
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);

      act(() => {
        useAppStore.getState().toggleSidebar();
      });
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  describe("sidebar hidden toggle", () => {
    it("should start visible (not hidden)", () => {
      expect(useAppStore.getState().sidebarHidden).toBe(false);
    });

    it("should toggle sidebar hidden state", () => {
      act(() => {
        useAppStore.getState().toggleSidebarHidden();
      });
      expect(useAppStore.getState().sidebarHidden).toBe(true);

      act(() => {
        useAppStore.getState().toggleSidebarHidden();
      });
      expect(useAppStore.getState().sidebarHidden).toBe(false);
    });

    it("should set sidebar hidden explicitly", () => {
      act(() => {
        useAppStore.getState().setSidebarHidden(true);
      });
      expect(useAppStore.getState().sidebarHidden).toBe(true);

      act(() => {
        useAppStore.getState().setSidebarHidden(false);
      });
      expect(useAppStore.getState().sidebarHidden).toBe(false);
    });
  });

  describe("reset", () => {
    it("should reset to initial state", () => {
      useAppStore.setState({ sidebarCollapsed: true, sidebarHidden: true });

      act(() => {
        useAppStore.getState().reset();
      });

      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
      expect(useAppStore.getState().sidebarHidden).toBe(false);
    });
  });
});
