import type { CheckResult, GameSave, ActorId } from "../types";
import type { IRNG } from "../rng";
import { addConditionToActor } from "../conditions";
import { applyFatigue } from "./fatigue";
import { applyDamageToActor } from "../combat/criticalDamage";
import { getCurrentTurnActorId } from "../combat/combat";

/**
 * Checks if phenomena should trigger based on casting roll
 * Triggers on:
 * - Doubles on roll (11, 22, 33, ..., 99, 00)
 * - Severe failure (2+ DoF)
 */
export function shouldTriggerPhenomena(check: CheckResult): boolean {
  if (!check) {
    return false;
  }

  // Check for doubles (11, 22, 33, ..., 99, 00/100)
  const roll = check.roll;
  // Normalize: 00 = 100 for doubles detection
  const normalizedRoll = roll === 0 ? 100 : roll;
  const tens = Math.floor(normalizedRoll / 10);
  const ones = normalizedRoll % 10;
  const isDoubles = tens === ones;

  // Check for severe failure (2+ DoF)
  const isSevereFailure = check.dof >= 2;

  return isDoubles || isSevereFailure;
}

/**
 * Determines phenomena severity
 * - Mild: if PI <= PM
 * - Severe: if PI > PM
 */
export function getPhenomenaSeverity(powerIntensity: number, powerMagic: number): "mild" | "severe" {
  return powerIntensity > powerMagic ? "severe" : "mild";
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
    const updatedActor = addConditionToActor(
      actor,
      "stunned",
      1,
      currentTurnCounter + 1,
      "phenomena"
    );
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
            scope: "check",
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

