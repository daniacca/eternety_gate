import type { GameSave, Actor, ActorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getTalentById } from "../../content/loadCatalogs";
import { getCharacteristicBonus } from "./bonuses";
import { getTalentParams } from "./prerequisites";

/**
 * Gets the total modifier for a specific talent modifier key.
 * This handles talents with chosen params (like Resistance, Casting Specialization).
 */
export function getTalentModifierTotal(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  key: string
): number {
  const actor = save.actorsById[actorId];
  if (!actor) return 0;

  let total = 0;

  for (const [talentId, rank] of Object.entries(actor.talents)) {
    if (rank < 1) continue;
    const talent = getTalentById(catalogs, talentId);
    if (!talent) continue;

    for (const grant of talent.grants) {
      if (grant.type === "modifier") {
        let grantKey = grant.key;
        
        // Handle dynamic keys with chosen params (e.g., "combat.resistance.<chosenType>")
        if (talent.chosenParam && grantKey.includes(`<${talent.chosenParam.paramKey}>`)) {
          const params = getTalentParams(actor, talentId);
          const paramValue = params?.[talent.chosenParam.paramKey];
          if (typeof paramValue === "string") {
            grantKey = grantKey.replace(`<${talent.chosenParam.paramKey}>`, paramValue);
          } else {
            continue; // Can't resolve key without param value
          }
        }

        if (grantKey === key) {
          total += grant.value * rank;
        }
      }
    }
  }

  return total;
}

/**
 * Checks if actor has a talent hook (e.g., dieHard, denyTheWitch)
 */
export function hasTalentHook(
  actor: Actor,
  catalogs: CharacterCatalogs,
  hookId: string
): boolean {
  for (const [talentId, rank] of Object.entries(actor.talents)) {
    if (rank < 1) continue;
    const talent = getTalentById(catalogs, talentId);
    if (!talent) continue;

    for (const grant of talent.grants) {
      if (grant.type === "hook" && grant.hookId === hookId) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Gets Shield Mastery parry bonus if actor has shield equipped and talent
 * Returns +10 per rank (rank 1 = +10, rank 2 = +20)
 */
export function getShieldMasteryParryBonus(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): number {
  const actor = save.actorsById[actorId];
  if (!actor) return 0;

  // Check if actor has shield equipped in off-hand
  const offHand = actor.equipment?.offHand;
  const hasShield = offHand?.kind === "armor" || (offHand?.id && offHand.id.includes("shield"));
  if (!hasShield) return 0;

  // Get Shield Mastery bonus (10 per rank)
  return getTalentModifierTotal(save, catalogs, actorId, "combat.shieldMasteryParryBonus");
}

/**
 * Gets Combat Master melee to-be-hit penalty (attackers suffer -20)
 */
export function getCombatMasterPenalty(
  save: GameSave,
  catalogs: CharacterCatalogs,
  defenderActorId: ActorId
): number {
  return getTalentModifierTotal(save, catalogs, defenderActorId, "combat.meleeToBeHitPenalty");
}

/**
 * Gets Crushing Blow damage bonus: ceil(WS Bonus / 2)
 */
export function getCrushingBlowDamageBonus(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): number {
  const hasTalent = getTalentModifierTotal(save, catalogs, actorId, "combat.crushingBlowDamageBonus") > 0;
  if (!hasTalent) return 0;

  const wsBonus = getCharacteristicBonus(save, actorId, "WS", catalogs);
  return Math.ceil(wsBonus / 2);
}

/**
 * Gets Deathdealer damage bonus: PER Bonus
 */
export function getDeathdealerDamageBonus(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): number {
  const hasTalent = getTalentModifierTotal(save, catalogs, actorId, "combat.deathdealerDamageBonus") > 0;
  if (!hasTalent) return 0;

  return getCharacteristicBonus(save, actorId, "PER", catalogs);
}

/**
 * Checks if actor has Marksman talent (ignores distance penalties)
 */
export function hasMarksmanTalent(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): boolean {
  return getTalentModifierTotal(save, catalogs, actorId, "combat.marksmanIgnoreDistance") > 0;
}

/**
 * Checks if actor has Deadeye talent (ignores light cover, treats heavy as light)
 */
export function hasDeadeyeTalent(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): boolean {
  return getTalentModifierTotal(save, catalogs, actorId, "combat.deadeyeIgnoreCover") > 0;
}

/**
 * Gets the fatigue penalty reduction from Relentless talent
 * Returns number of penalty tiers to ignore (usually 1)
 */
export function getFatiguePenaltyReduction(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): number {
  return getTalentModifierTotal(save, catalogs, actorId, "combat.fatiguePenaltyReduction");
}

/**
 * Checks if actor has Leap Up talent (stand up as free action)
 */
export function hasLeapUpTalent(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): boolean {
  return getTalentModifierTotal(save, catalogs, actorId, "combat.leapUp") > 0;
}

/**
 * Gets resistance bonus for a specific type
 */
export function getResistanceBonus(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  resistanceType: "poison" | "magic" | "disease" | "fear"
): number {
  return getTalentModifierTotal(save, catalogs, actorId, `combat.resistance.${resistanceType}`);
}

/**
 * Gets channeling bonus from Channelling Focus
 */
export function getChannelingBonus(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): number {
  return getTalentModifierTotal(save, catalogs, actorId, "magic.channelBonus");
}

/**
 * Gets casting bonus for a specific discipline from Casting Specialization
 */
export function getCastingSpecializationBonus(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  discipline: "PYRA" | "KINESIS" | "MENTIS" | "VATES" | "CORPUS"
): number {
  return getTalentModifierTotal(save, catalogs, actorId, `magic.castBonus.${discipline}`);
}

/**
 * Applies all melee damage bonuses from talents (Crushing Blow, Deathdealer)
 */
export function getMeleeDamageBonusFromTalents(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): number {
  let bonus = 0;
  bonus += getCrushingBlowDamageBonus(save, catalogs, actorId);
  bonus += getDeathdealerDamageBonus(save, catalogs, actorId);
  return bonus;
}

/**
 * Applies all ranged damage bonuses from talents (Deathdealer)
 * Note: Mighty Shot is handled separately in mightyShot.ts
 */
export function getRangedDamageBonusFromTalents(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): number {
  // Deathdealer applies to both melee and ranged
  return getDeathdealerDamageBonus(save, catalogs, actorId);
}
