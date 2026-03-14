/**
 * agentActivityStore — Session staleness eviction tests
 *
 * Verifies that orphaned sessions (agents that crash without Stop events)
 * are automatically evicted after MAX_SESSION_STALE_MS (4 hours).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/payload-helpers", () => ({
  getPayloadString: () => undefined,
  getPayloadObject: () => undefined,
}));

// NOTE: Run this file individually (bun test tests/frontend/agentActivityStore-eviction.test.ts)
// as bun's vitest shim lacks vi.unmock, causing cross-file mock contamination in full suite runs.
import { useAgentActivityStore } from "../../src/features/git/stores/agentActivityStore";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

function makeHookEvent(projectPath: string, eventType: string) {
  return {
    projectPath,
    eventType,
    payload: {},
    timestamp: new Date().toISOString(),
  };
}

/** Directly set a session's lastActivity to a past time */
function ageSession(sessionKey: string, ageMs: number) {
  const state = useAgentActivityStore.getState();
  const session = state.sessions[sessionKey];
  if (!session) return;
  const oldTime = new Date(Date.now() - ageMs).toISOString();
  useAgentActivityStore.setState({
    sessions: {
      ...state.sessions,
      [sessionKey]: { ...session, lastActivity: oldTime },
    },
  });
}

describe("agentActivityStore session eviction", () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>;
  let baseTime: number;

  beforeEach(() => {
    useAgentActivityStore.getState().reset();
    baseTime = Date.now();
    dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(baseTime);
  });

  afterEach(() => {
    dateNowSpy?.mockRestore();
  });

  it("should NOT evict sessions younger than 4 hours", () => {
    useAgentActivityStore.getState().pushActivity(
      makeHookEvent("/project-a", "PostToolUse") as never,
    );

    expect(Object.keys(useAgentActivityStore.getState().sessions).length).toBe(1);
  });

  it("should evict sessions older than 4 hours on next pushActivity", () => {
    // Create a session
    useAgentActivityStore.getState().pushActivity(
      makeHookEvent("/stale-project", "PostToolUse") as never,
    );

    // Manually age the session to 4h+1min
    ageSession("/stale-project", FOUR_HOURS_MS + 60_000);

    // Advance Date.now past eviction interval (5 min from last check)
    dateNowSpy.mockReturnValue(baseTime + FIVE_MINUTES_MS + 1);

    // Push event for a different project (triggers eviction check)
    useAgentActivityStore.getState().pushActivity(
      makeHookEvent("/fresh-project", "PostToolUse") as never,
    );

    const sessions = useAgentActivityStore.getState().sessions;
    expect(sessions["/stale-project"]).toBeUndefined();
    expect(sessions["/fresh-project"]).toBeDefined();
  });

  it("should NOT evict 'done' sessions (they have their own 30s cleanup)", () => {
    // Create and stop a session
    useAgentActivityStore.getState().pushActivity(
      makeHookEvent("/done-project", "PostToolUse") as never,
    );
    useAgentActivityStore.getState().pushActivity(
      makeHookEvent("/done-project", "Stop") as never,
    );

    // Age it past 4h
    ageSession("/done-project", FOUR_HOURS_MS + 60_000);

    // Advance past eviction interval
    dateNowSpy.mockReturnValue(baseTime + FIVE_MINUTES_MS + 1);

    // Trigger eviction
    useAgentActivityStore.getState().pushActivity(
      makeHookEvent("/other", "PostToolUse") as never,
    );

    const sessions = useAgentActivityStore.getState().sessions;
    expect(sessions["/done-project"]).toBeDefined();
    expect(sessions["/done-project"].status).toBe("done");
  });

  it("should throttle eviction checks to every 5 minutes", () => {
    // Create a session
    useAgentActivityStore.getState().pushActivity(
      makeHookEvent("/stale", "PostToolUse") as never,
    );

    // Age it past 4h
    ageSession("/stale", FOUR_HOURS_MS + 60_000);

    // Advance only 2 min (within throttle window of 5 min)
    dateNowSpy.mockReturnValue(baseTime + 2 * 60 * 1000);

    // Push event — should NOT trigger eviction due to throttle
    useAgentActivityStore.getState().pushActivity(
      makeHookEvent("/other", "PostToolUse") as never,
    );

    const sessions = useAgentActivityStore.getState().sessions;
    expect(sessions["/stale"]).toBeDefined();
  });
});
