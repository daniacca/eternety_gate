import type { GameSave } from "../types";

const MAX_LOG = 50;

/**
 * Helper to append a combat log entry (immutable)
 * Returns a NEW save with the log entry appended
 */
export function appendCombatLog(save: GameSave, entry: string): GameSave {
  const currentLog = save.runtime.combatLog || [];
  const newLog = [...currentLog, entry];
  // Keep only last 50 entries to avoid memory issues
  const trimmedLog = newLog.slice(-MAX_LOG);
  
  // Calculate how many entries were removed when trimming
  const removedCount = Math.max(0, newLog.length - MAX_LOG);
  
  // Adjust combatTurnStartIndex to account for trimmed entries
  // This ensures the index remains valid relative to the trimmed log
  const adjustedCombatTurnStartIndex =
    save.runtime.combatTurnStartIndex !== undefined
      ? Math.max(0, save.runtime.combatTurnStartIndex - removedCount)
      : undefined;
  
  return {
    ...save,
    runtime: {
      ...save.runtime,
      combatLog: trimmedLog,
      combatTurnStartIndex: adjustedCombatTurnStartIndex,
    },
  };
}

