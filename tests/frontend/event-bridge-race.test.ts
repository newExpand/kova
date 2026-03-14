/**
 * Event Bridge Race Condition Tests
 *
 * Verifies that the generation counter prevents orphaned listeners
 * when init/destroy overlap (e.g., React StrictMode double mount).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Track all listeners created by listen() ──────────────────────────────

type ListenCallback = (event: unknown) => void;
interface TrackedListener {
  event: string;
  callback: ListenCallback;
  unlisten: ReturnType<typeof vi.fn>;
}

const activeListeners: TrackedListener[] = [];

// Mock @tauri-apps/api/event with async delay to simulate real listen()
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, callback: ListenCallback) => {
    // Simulate the async nature of Tauri's listen() registration
    await new Promise((resolve) => setTimeout(resolve, 10));
    const unlisten = vi.fn(() => {
      const idx = activeListeners.findIndex((l) => l.unlisten === unlisten);
      if (idx !== -1) activeListeners.splice(idx, 1);
    });
    const listener: TrackedListener = { event, callback, unlisten };
    activeListeners.push(listener);
    return unlisten;
  }),
}));

// Mock all store imports to prevent side effects
vi.mock("../../src/features/notification", () => ({
  useNotificationStore: { getState: () => ({}) },
}));
vi.mock("../../src/features/notification/types", () => ({
  parseHookType: (t: string) => t,
}));
vi.mock("../../src/features/git", () => ({
  useAgentActivityStore: { getState: () => ({}) },
  useGitStore: { getState: () => ({}) },
  toProjectPathKey: (p: string) => p,
}));
vi.mock("../../src/features/project", () => ({
  useProjectStore: { getState: () => ({ projects: [] }) },
}));
vi.mock("../../src/features/files", () => ({
  useAgentFileTrackingStore: { getState: () => ({}) },
  extractFilePath: () => null,
  resolveCanonicalFilePath: () => null,
}));
vi.mock("../../src/lib/payload-helpers", () => ({
  getPayloadString: () => undefined,
  getPayloadObject: () => undefined,
}));

// Import after mocks are set up
import { initEventBridge, destroyEventBridge } from "../../src/lib/event-bridge";

describe("Event Bridge Race Condition", () => {
  beforeEach(() => {
    // Clear all tracked listeners
    activeListeners.length = 0;
    vi.clearAllMocks();
  });

  it("should have exactly 4 listeners after init", async () => {
    await initEventBridge();
    expect(activeListeners).toHaveLength(4);
  });

  it("should have 0 listeners after init → destroy", async () => {
    await initEventBridge();
    destroyEventBridge();
    expect(activeListeners).toHaveLength(0);
  });

  it("should have only 4 listeners after StrictMode double-mount (init → destroy → init)", async () => {
    // Simulate React StrictMode: mount → unmount → remount
    const firstInit = initEventBridge();
    destroyEventBridge();
    const secondInit = initEventBridge();

    // Wait for both inits to complete
    await firstInit;
    await secondInit;

    // Only the second init's listeners should be active — exactly 4
    expect(activeListeners).toHaveLength(4);
  });

  it("should have only 4 listeners after 5 rapid init/destroy cycles + final init", async () => {
    const promises: Promise<void>[] = [];

    // Simulate rapid mount/unmount cycles
    for (let i = 0; i < 5; i++) {
      promises.push(initEventBridge());
      destroyEventBridge();
    }

    // Final init (the "real" mount)
    promises.push(initEventBridge());

    // Wait for ALL promises to settle
    await Promise.all(promises);

    // Only the last init's listeners should be active — exactly 4
    expect(activeListeners).toHaveLength(4);
  });
});
