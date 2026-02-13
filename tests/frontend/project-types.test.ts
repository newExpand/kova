/**
 * Project Types Tests — PLAN.md Feature: 8색 팔레트
 *
 * Tests:
 * - COLOR_PALETTE has exactly 8 colors
 * - Color indices map correctly
 */
import { describe, it, expect } from "vitest";
import { COLOR_PALETTE } from "../../src/features/project/types";

describe("Project Types", () => {
  describe("COLOR_PALETTE", () => {
    it("should have exactly 8 colors", () => {
      expect(COLOR_PALETTE).toHaveLength(8);
    });

    it("should have valid color strings", () => {
      for (const color of COLOR_PALETTE) {
        expect(typeof color).toBe("string");
        expect(color.length).toBeGreaterThan(0);
      }
    });

    it("should have unique colors", () => {
      const unique = new Set(COLOR_PALETTE);
      expect(unique.size).toBe(COLOR_PALETTE.length);
    });

    it("color indices 0-7 should map to valid entries", () => {
      for (let i = 0; i < 8; i++) {
        expect(COLOR_PALETTE[i]).toBeDefined();
      }
    });
  });
});
