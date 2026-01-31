import type { RuntimeLogEntry } from "@eg/engine";

/**
 * Gets the last check entry from runtimeLog for party/player actors.
 * Returns the most recent check entry (kind: "check") performed by a party member.
 */
export function getLastPartyCheck(runtimeLog?: RuntimeLogEntry[]): Extract<RuntimeLogEntry, { kind: "check" }> | null {
  if (!runtimeLog || runtimeLog.length === 0) {
    return null;
  }

  // Iterate backwards to find the last check entry
  for (let i = runtimeLog.length - 1; i >= 0; i--) {
    const entry = runtimeLog[i];
    if (entry.kind === "check") {
      return entry;
    }
  }

  return null;
}

/**
 * Gets the damage entry related to a specific resolutionId.
 * Returns the last damage entry (kind: "damage") with the matching resolutionId.
 * If multiple damage entries share the same resolutionId, returns the last one.
 */
export function getRelatedDamage(
  runtimeLog: RuntimeLogEntry[] | undefined,
  resolutionId: string | undefined
): Extract<RuntimeLogEntry, { kind: "damage" }> | null {
  if (!runtimeLog || !resolutionId) {
    return null;
  }

  // Iterate backwards to find the last damage entry with matching resolutionId
  for (let i = runtimeLog.length - 1; i >= 0; i--) {
    const entry = runtimeLog[i];
    if (entry.kind === "damage" && entry.resolutionId === resolutionId) {
      return entry;
    }
  }

  return null;
}

