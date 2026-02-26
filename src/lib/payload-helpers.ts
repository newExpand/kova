/**
 * Typed accessors for unknown hook event payloads.
 *
 * Used by both event-bridge (dispatch) and agentActivityStore (consumption)
 * to safely extract typed values from raw hook payloads.
 */

export function getPayloadString(
  payload: unknown,
  key: string,
): string | undefined {
  if (typeof payload === "object" && payload !== null) {
    const val = (payload as Record<string, unknown>)[key];
    return typeof val === "string" ? val : undefined;
  }
  return undefined;
}

export function getPayloadObject(
  payload: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (typeof payload === "object" && payload !== null) {
    const val = (payload as Record<string, unknown>)[key];
    return typeof val === "object" && val !== null && !Array.isArray(val)
      ? (val as Record<string, unknown>)
      : undefined;
  }
  return undefined;
}
