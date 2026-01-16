import type { GameSave, Actor, ActorId, SingleCheck, CheckResult, StatKey } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import type { IRNG } from "../rng";
import { hasTalentHook } from "../characters/talentModifiers";
import { getCharacteristicValue } from "../characters/bonuses";
import { performCheckWithSave } from "../checks";
import { hasTrait } from "../characters/prerequisites";

/**
 * Checks if an actor has the Deny the Witch talent
 */
export function hasDenyTheWitch(
  actor: Actor,
  catalogs: CharacterCatalogs
): boolean {
  return hasTalentHook(actor, catalogs, "denyTheWitch");
}

/**
 * Gets the best resistance stat for a defender with Deny the Witch
 * Returns max(defenderStat, WIL) - the defender always uses their best option
 */
export function getBestResistStat(
  actor: Actor,
  defaultStat: StatKey,
  save: GameSave,
  catalogs: CharacterCatalogs
): StatKey {
  if (!hasDenyTheWitch(actor, catalogs)) {
    return defaultStat;
  }

  // Compare the default stat value with WIL and return the better one
  const defaultValue = getCharacteristicValue(actor.id, defaultStat, save);
  const willValue = getCharacteristicValue(actor.id, "WIL", save);

  // Return the stat with higher value
  return willValue >= defaultValue ? "WIL" : defaultStat;
}

/**
 * Checks if actor is a Weaver (has magic trait)
 */
export function isWeaver(actor: Actor): boolean {
  return hasTrait(actor, "trait:weaver");
}

/**
 * Performs a Deny the Witch Will check for a non-opposed spell
 * Returns true if the defender successfully negates the effect on themselves ONLY
 * 
 * Rules:
 * - Non-casters (non-Weavers) suffer -10 penalty to the Will test
 * - Deny the Witch does NOT cancel the spell, only negates effects on this character
 * - Defender must match or beat caster's DoS to succeed
 * 
 * Note: This function only applies the non-Weaver penalty specific to Deny the Witch.
 * Other bonuses like Resistance (Magic) should be passed via additionalModifier parameter.
 * 
 * @param defender - The defending actor
 * @param castDoS - The caster's casting check DoS (used as the opposed value)
 * @param save - The game save
 * @param rng - Random number generator
 * @param spellId - The spell ID (for logging)
 * @param catalogs - Character catalogs
 * @param additionalModifier - Optional additional modifier (e.g., Resistance Magic bonus)
 * @returns Object with success flag and updated save
 */
export function performDenyTheWitchCheck(
  defender: Actor,
  castDoS: number,
  save: GameSave,
  rng: IRNG,
  spellId: string,
  catalogs: CharacterCatalogs,
  additionalModifier: number = 0
): {
  success: boolean;
  save: GameSave;
  checkResult: CheckResult | null;
} {
  // Only defenders with Deny the Witch can attempt this
  if (!hasDenyTheWitch(defender, catalogs)) {
    return { success: false, save, checkResult: null };
  }

  // Non-Weavers suffer -10 penalty (specific to Deny the Witch talent)
  const defenderIsWeaver = isWeaver(defender);
  const nonWeaverPenalty = defenderIsWeaver ? 0 : -10;

  // Total modifier = non-weaver penalty + any additional modifiers (e.g., Resistance Magic)
  const totalModifier = nonWeaverPenalty + additionalModifier;

  // Perform Will check with combined modifiers
  const denyCheck: SingleCheck = {
    id: `combat:denyTheWitch:${spellId}:${defender.id}`,
    kind: "single",
    actorRef: { mode: "byId", actorId: defender.id },
    key: "WIL",
    difficulty: "Challenging",
    modifier: totalModifier,
  };

  const { result, save: saveAfterCheck } = performCheckWithSave(
    denyCheck,
    undefined, // No storyPack needed for basic check
    save,
    rng,
    `res:denyTheWitch:${spellId}:${defender.id}`
  );

  if (!result) {
    return { success: false, save: saveAfterCheck, checkResult: null };
  }

  // Add modifier tags if applicable
  const updatedResult: CheckResult = {
    ...result,
    tags: [
      ...result.tags,
      ...(nonWeaverPenalty !== 0 ? [`denyTheWitch:nonWeaverPenalty=${nonWeaverPenalty}`] : []),
      ...(additionalModifier !== 0 ? [`magic:resistanceBonus=${additionalModifier > 0 ? "+" : ""}${additionalModifier}`] : []),
    ],
  };

  // Compare defender's DoS against caster's DoS
  // Defender succeeds if their DoS >= caster's DoS (they only need to match or beat)
  const defenderDoS = result.success ? result.dos : -1;
  const success = defenderDoS >= castDoS;

  return {
    success,
    save: saveAfterCheck,
    checkResult: updatedResult,
  };
}
