import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted runs before vi.mock factories
// ---------------------------------------------------------------------------

const { mockKillIdleAgent, mockClearSession, mockSettings, mockSessionsRef } =
  vi.hoisted(() => ({
    mockKillIdleAgent: vi.fn(),
    mockClearSession: vi.fn(),
    mockSettings: { idleCleanupEnabled: true, idleCleanupHours: 1 } as {
      idleCleanupEnabled: boolean;
      idleCleanupHours: number;
    },
    mockSessionsRef: { current: {} as Record<string, unknown> },
  }));

vi.mock("../../src/lib/tauri/commands", () => ({
  killIdleAgent: mockKillIdleAgent,
}));

vi.mock("../../src/features/settings/stores/settingsStore", () => ({
  useSettingsStore: vi.fn(
    (selector: (s: typeof mockSettings) => unknown) => selector(mockSettings),
  ),
}));

vi.mock("../../src/features/git/stores/agentActivityStore", () => ({
  useAgentActivityStore: {
    getState: () => ({
      sessions: mockSessionsRef.current,
      clearSession: mockClearSession,
    }),
  },
}));

// Import AFTER vi.mock (hoisted, so mocks are already in place)
import { useIdleAgentCleanup } from "../../src/hooks/useIdleAgentCleanup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

function makeIdleSession(overrides: Record<string, unknown> = {}) {
  return {
    status: "idle",
    paneId: "%1",
    lastActivity: TWO_HOURS_AGO,
    isWaitingForInput: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useIdleAgentCleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockSettings.idleCleanupEnabled = true;
    mockSettings.idleCleanupHours = 1;
    mockSessionsRef.current = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should NOT set interval when disabled", () => {
    mockSettings.idleCleanupEnabled = false;

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    renderHook(() => useIdleAgentCleanup());

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it("Phase 1: should send SIGTERM and NOT clearSession when agent is alive", async () => {
    mockSessionsRef.current = { "/proj": makeIdleSession() };
    mockKillIdleAgent.mockResolvedValue(12345);

    renderHook(() => useIdleAgentCleanup());

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(mockKillIdleAgent).toHaveBeenCalledWith("%1");
    expect(mockClearSession).not.toHaveBeenCalled();
  });

  it("Phase 2: should clearSession when agent is already dead (null)", async () => {
    mockSessionsRef.current = { "/proj": makeIdleSession() };
    mockKillIdleAgent.mockResolvedValue(null);

    renderHook(() => useIdleAgentCleanup());

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(mockKillIdleAgent).toHaveBeenCalledWith("%1");
    expect(mockClearSession).toHaveBeenCalledWith("/proj");
  });

  it("Some→null sequence: Phase 1 keeps session, Phase 2 clears ghost", async () => {
    mockSessionsRef.current = { "/proj": makeIdleSession() };

    // Phase 1: agent alive → SIGTERM sent
    mockKillIdleAgent.mockResolvedValueOnce(12345);
    // Phase 2: agent dead → null
    mockKillIdleAgent.mockResolvedValueOnce(null);

    renderHook(() => useIdleAgentCleanup());

    // Cycle 1
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(mockKillIdleAgent).toHaveBeenCalledTimes(1);
    expect(mockClearSession).not.toHaveBeenCalled();

    // Cycle 2
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(mockKillIdleAgent).toHaveBeenCalledTimes(2);
    expect(mockClearSession).toHaveBeenCalledWith("/proj");
  });

  it("should skip sessions that are active, waitingForInput, or missing paneId", async () => {
    mockSessionsRef.current = {
      "/active": makeIdleSession({ status: "active" }),
      "/loading": makeIdleSession({ status: "loading" }),
      "/waiting": makeIdleSession({ isWaitingForInput: true }),
      "/nopane": makeIdleSession({ paneId: undefined }),
      "/fresh": makeIdleSession({
        lastActivity: new Date().toISOString(),
      }),
    };

    renderHook(() => useIdleAgentCleanup());

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(mockKillIdleAgent).not.toHaveBeenCalled();
  });
});
