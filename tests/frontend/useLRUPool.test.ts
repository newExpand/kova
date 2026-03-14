/**
 * useLRUPool Tests — bounded LRU pool hook for memory management
 *
 * Tests:
 * - Pool add / MRU promotion
 * - Eviction when exceeding maxSize
 * - onEvict callback behavior
 * - Edge cases (null activeId, maxSize=1, duplicates)
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLRUPool } from "../../src/hooks/useLRUPool";

describe("useLRUPool", () => {
  it("should add activeId to pool", () => {
    const { result } = renderHook(() => useLRUPool("a", 5));
    expect(result.current).toEqual(["a"]);
  });

  it("should promote existing item to MRU (end of array)", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useLRUPool(id, 5),
      { initialProps: { id: "a" } },
    );
    act(() => rerender({ id: "b" }));
    act(() => rerender({ id: "c" }));
    // Re-activate "a" — should move to end
    act(() => rerender({ id: "a" }));
    expect(result.current).toEqual(["b", "c", "a"]);
  });

  it("should evict LRU (front) when pool exceeds maxSize", () => {
    const onEvict = vi.fn();
    const { result, rerender } = renderHook(
      ({ id }) => useLRUPool(id, 2, onEvict),
      { initialProps: { id: "a" } },
    );
    act(() => rerender({ id: "b" }));
    act(() => rerender({ id: "c" }));

    expect(result.current).toEqual(["b", "c"]);
    expect(onEvict).toHaveBeenCalledWith("a");
  });

  it("should call onEvict for each evicted item", () => {
    const onEvict = vi.fn();
    const { rerender } = renderHook(
      ({ id, max }) => useLRUPool(id, max, onEvict),
      { initialProps: { id: "a", max: 5 } },
    );
    act(() => rerender({ id: "b", max: 5 }));
    act(() => rerender({ id: "c", max: 5 }));
    act(() => rerender({ id: "d", max: 5 }));

    // Shrink maxSize from 5 to 2 — should evict "a" and "b"
    act(() => rerender({ id: "d", max: 2 }));

    expect(onEvict).toHaveBeenCalledWith("a");
    expect(onEvict).toHaveBeenCalledWith("b");
  });

  it("should never evict the activeId", () => {
    const onEvict = vi.fn();
    const { result, rerender } = renderHook(
      ({ id }) => useLRUPool(id, 1, onEvict),
      { initialProps: { id: "a" } },
    );
    act(() => rerender({ id: "b" }));

    // "a" evicted, "b" remains as activeId
    expect(result.current).toEqual(["b"]);
    expect(onEvict).toHaveBeenCalledWith("a");
    expect(onEvict).not.toHaveBeenCalledWith("b");
  });

  it("should not add null activeId", () => {
    const { result } = renderHook(() => useLRUPool(null, 5));
    expect(result.current).toEqual([]);
  });

  it("should handle maxSize of 1", () => {
    const onEvict = vi.fn();
    const { result, rerender } = renderHook(
      ({ id }) => useLRUPool(id, 1, onEvict),
      { initialProps: { id: "a" } },
    );
    expect(result.current).toEqual(["a"]);

    act(() => rerender({ id: "b" }));
    expect(result.current).toEqual(["b"]);
    expect(onEvict).toHaveBeenCalledWith("a");
  });

  it("should not duplicate items in pool on re-activation", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useLRUPool(id, 5),
      { initialProps: { id: "a" } },
    );
    act(() => rerender({ id: "b" }));
    act(() => rerender({ id: "a" })); // re-activate "a"
    act(() => rerender({ id: "a" })); // same id again

    const count = result.current.filter((id) => id === "a").length;
    expect(count).toBe(1);
    expect(result.current).toEqual(["b", "a"]);
  });

  it("should clear pending evictions without crash when onEvict is undefined", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useLRUPool(id, 1), // no onEvict
      { initialProps: { id: "a" } },
    );
    act(() => rerender({ id: "b" }));

    // Should not crash, "a" silently evicted
    expect(result.current).toEqual(["b"]);
  });
});
