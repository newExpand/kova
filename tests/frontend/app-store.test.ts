/**
 * App Store Tests — PLAN.md Feature: 사이드바 접기/펼치기
 *
 * Tests:
 * - Sidebar collapsed/expanded toggle
 * - Onboarding state
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

  describe("reset", () => {
    it("should reset to initial state", () => {
      useAppStore.setState({ sidebarCollapsed: true });

      act(() => {
        useAppStore.getState().reset();
      });

      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });
  });
});
