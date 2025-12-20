import type { GameSave } from "../types";

/**
 * Helper to append a combat log entry (immutable)
 * Returns a NEW save with the log entry appended
 */
export function appendCombatLog(save: GameSave, entry: string): GameSave {
  const currentLog = save.runtime.combatLog || [];
  const newLog = [...currentLog, entry];
  // Keep only last 50 entries to avoid memory issues
  const trimmedLog = newLog.slice(-50);
  return {
    ...save,
    runtime: {
      ...save.runtime,
      combatLog: trimmedLog,
    },
  };
}

