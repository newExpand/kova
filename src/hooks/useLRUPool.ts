import { useState, useEffect, useRef } from "react";

/**
 * Bounded LRU pool that keeps at most `maxSize` items.
 * When a new item is added and the pool is full, the least-recently-used item(s)
 * are evicted and `onEvict` is called for each.
 *
 * - Re-activating an existing item promotes it to MRU (moves to end).
 * - `activeId` is never evicted.
 * - `onEvict` is called from useEffect (after React commits), ensuring
 *   unmount cleanup runs before store-level cleanup.
 */
export function useLRUPool(
  activeId: string | null,
  maxSize: number,
  onEvict?: (evictedId: string) => void,
): string[] {
  const [pool, setPool] = useState<string[]>([]);
  const pendingEvictions = useRef<string[]>([]);

  useEffect(() => {
    if (!activeId) return;

    setPool((prev) => {
      // Remove existing entry (will re-add at end for MRU promotion)
      const without = prev.filter((id) => id !== activeId);
      const next = [...without, activeId];

      // Evict oldest items (front of array) if over capacity
      // Never evict activeId (it's always at the end)
      while (next.length > maxSize) {
        const evicted = next.shift();
        if (evicted) {
          pendingEvictions.current.push(evicted);
        }
      }

      return next;
    });
  }, [activeId, maxSize]);

  // Fire onEvict callbacks after React has committed (unmount cleanup runs first).
  // Depends on [pool] because setPool() is the only path that queues evictions,
  // and every eviction changes the pool array reference.
  useEffect(() => {
    if (pendingEvictions.current.length === 0) return;
    if (!onEvict) {
      pendingEvictions.current = [];
      return;
    }
    const evictions = [...pendingEvictions.current];
    pendingEvictions.current = [];
    for (const id of evictions) {
      onEvict(id);
    }
  }, [pool, onEvict]);

  return pool;
}
