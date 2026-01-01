import type { GameSave, Actor, CheckResult } from "../types";

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

/**
 * Appends narration for an attack result (hit/miss, defense, stance effects)
 * Consolidates all attack narration in one place to avoid duplication
 */
export function appendAttackNarration(
  save: GameSave,
  attacker: Actor | null,
  defender: Actor | null,
  result: CheckResult | null
): GameSave {
  if (!result || !attacker || !defender) {
    return save;
  }

  let updatedSave = save;
  const defenderName = defender.name || "il bersaglio";
  const attackerName = attacker.name || "l'attaccante";
  const isPlayerAttacker = attacker.kind === "PC";

  if (result.success) {
    // HIT: no defense narration here
    const defenderStanceTag = result.tags.find((t) => t.startsWith("combat:defenderStance="));
    if (defenderStanceTag?.endsWith("=defend")) {
      updatedSave = appendCombatLog(updatedSave, `Il bersaglio è in difesa: è più difficile colpirlo.`);
    }
    return updatedSave;
  }

  // MISS (includes successful parry/dodge)
  const defenseTag = result.tags.find((t) => t.startsWith("combat:defense="));
  if (defenseTag?.endsWith("=parry")) {
    updatedSave = appendCombatLog(updatedSave, `${defenderName} para il colpo.`);
  } else if (defenseTag?.endsWith("=dodge")) {
    updatedSave = appendCombatLog(updatedSave, `${defenderName} schiva il colpo.`);
  } else {
    updatedSave = appendCombatLog(
      updatedSave,
      isPlayerAttacker ? `Il tuo attacco manca il bersaglio.` : `${attackerName} manca il colpo.`
    );
  }

  // Check for stance effects on miss
  const defenderStanceTag = result.tags.find((t) => t.startsWith("combat:defenderStance="));
  if (defenderStanceTag) {
    const defenderStance = defenderStanceTag.split("=")[1];
    if (defenderStance === "defend") {
      updatedSave = appendCombatLog(updatedSave, `Il bersaglio è in difesa: è più difficile colpirlo.`);
    }
  }

  return updatedSave;
}
