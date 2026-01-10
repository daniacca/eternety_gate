import type { CheckResult, GameSave, ActorId } from "../types";
import type { IRNG } from "../rng";
import { addConditionToActor } from "../conditions";
import { applyFatigue } from "../characters/fatigue";
import { applyDamageToActor } from "../combat/criticalDamage";

/**
 * Normalizes d100 roll for doubles detection
 * 00/0 is treated as 100
 */
export function normalizeD100(roll: number): number {
  return roll === 0 ? 100 : roll;
}

/**
 * Checks if phenomena should trigger based on casting roll
 * Triggers on:
 * - Doubles on roll (11, 22, 33, ..., 99, 00/100)
 */
export function shouldTriggerPhenomena(check: CheckResult): boolean {
  if (!check) {
    return false;
  }

  // Check for doubles (11, 22, 33, ..., 99, 00/100)
  const roll = check.roll;
  const normalizedRoll = normalizeD100(roll);
  const tens = Math.floor(normalizedRoll / 10);
  const ones = normalizedRoll % 10;
  const isDoubles = tens === ones;

  return isDoubles;
}

/**
 * Determines phenomena severity
 * - Severe: if (cnBase > PM) OR (effectiveDoS < cnBase)  // "pushed" or failed
 * - Mild: otherwise
 */
export function getPhenomenaSeverity(cnBase: number, powerMagic: number, effectiveDoS: number): "mild" | "severe" {
  const isPushed = cnBase > powerMagic;
  const isFailed = effectiveDoS < cnBase;
  return isPushed || isFailed ? "severe" : "mild";
}

/**
 * Rolls on the phenomena table and applies the result
 *
 * Table (d100):
 * - 01-20: stunned 1 round
 * - 21-40: +1 RF
 * - 41-60: -20 next casting (temporary condition)
 * - 61-80: target randomization (spell retarget)
 * - 81-100: backlash: 1d10 true damage (no mitigation)
 *
 * @param save - The game save
 * @param actorId - The caster actor ID
 * @param rng - Random number generator
 * @param catalogs - Optional character catalogs
 * @returns Updated save and phenomena result
 */
export function rollPhenomena(
  save: GameSave,
  actorId: ActorId,
  rng: IRNG,
  catalogs?: any
): {
  save: GameSave;
  kind: string;
  description: string;
} {
  const roll = rng.nextInt(1, 100);
  const actor = save.actorsById[actorId];
  const combat = save.runtime.combat;
  const currentTurnCounter = combat?.turnCounter ?? 0;

  let updatedSave = save;
  let kind = "";
  let description = "";

  if (roll <= 20) {
    // 01-20: stunned 1 round
    kind = "stunned";
    description = "Stordito per 1 round";
    const updatedActor = addConditionToActor(actor, "stunned", 1, currentTurnCounter + 1, "phenomena");
    updatedSave = {
      ...updatedSave,
      actorsById: {
        ...updatedSave.actorsById,
        [actorId]: updatedActor,
      },
    };
  } else if (roll <= 40) {
    // 21-40: +1 RF
    kind = "fatigue";
    description = "+1 RF";
    updatedSave = applyFatigue(updatedSave, actorId, 1, catalogs);
  } else if (roll <= 60) {
    // 41-60: -20 next casting (temporary condition)
    kind = "castingPenalty";
    description = "-20 al prossimo lancio";
    // Add a temporary modifier that will be consumed on next cast
    const updatedActor = {
      ...actor,
      status: {
        ...actor.status,
        tempModifiers: [
          ...(actor.status.tempModifiers || []),
          {
            id: `phenomena:castingPenalty:${actorId}`,
            scope: "check" as const,
            key: null, // Applies to all checks
            value: -20,
            expires: currentTurnCounter + 999, // Lasts until consumed
          },
        ],
      },
    };
    updatedSave = {
      ...updatedSave,
      actorsById: {
        ...updatedSave.actorsById,
        [actorId]: updatedActor,
      },
    };
  } else if (roll <= 80) {
    // 61-80: target randomization (spell retarget)
    // For MVP: if targetShape is single, choose random among alive combatants excluding caster
    kind = "targetRandomization";
    description = "Bersaglio randomizzato";
    // This will be handled in the casting action - just log it here
  } else {
    // 81-100: backlash: 1d10 true damage (no mitigation)
    kind = "backlash";
    const damage = rng.nextInt(1, 10);
    description = `Contraccolpo: ${damage} danni veri`;
    // Apply true damage (bypasses armor)
    const damageResult = applyDamageToActor(actor, damage, updatedSave, rng);
    updatedSave = {
      ...updatedSave,
      actorsById: {
        ...updatedSave.actorsById,
        [actorId]: damageResult.updatedActor,
      },
    };
  }

  return {
    save: updatedSave,
    kind,
    description,
  };
}
