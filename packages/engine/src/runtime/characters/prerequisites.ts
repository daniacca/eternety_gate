import type { GameSave, Actor } from "../types";
import type { CharacterCatalogs, Prerequisite, Talent } from "../../content/catalogs";
import { getCharacteristicValue } from "./bonuses";

/**
 * Talent params stored on actor for talents with choices (e.g., Resistance: poison)
 * Stored as actor.talentParams?.[talentId] = { chosenType: "poison" }
 */
export type TalentParams = Record<string, string | number | boolean>;

/**
 * Evaluates prerequisites for a talent
 */
export function evaluatePrerequisites(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actor: Actor,
  prerequisites: Prerequisite[]
): { valid: boolean; reason?: string } {
  for (const prereq of prerequisites) {
    if (prereq.type === "statAtLeast") {
      const statValue = getCharacteristicValue(actor.id, prereq.stat, save);
      if (statValue < prereq.value) {
        return {
          valid: false,
          reason: `Requires ${prereq.stat} >= ${prereq.value}, but has ${statValue}`,
        };
      }
    } else if (prereq.type === "hasTalent") {
      const talentRank = actor.talents[prereq.talentId] ?? 0;
      if (talentRank < 1) {
        return {
          valid: false,
          reason: `Requires talent ${prereq.talentId}`,
        };
      }
    } else if (prereq.type === "hasTalentRank") {
      const talentRank = actor.talents[prereq.talentId] ?? 0;
      if (talentRank < prereq.minRank) {
        return {
          valid: false,
          reason: `Requires ${prereq.talentId} at rank ${prereq.minRank}+, but has ${talentRank}`,
        };
      }
    } else if (prereq.type === "hasTrait") {
      const hasTraitResult = hasTrait(actor, prereq.traitId, save);
      if (!hasTraitResult) {
        return {
          valid: false,
          reason: `Requires trait ${prereq.traitId}`,
        };
      }
    } else if (prereq.type === "hasSpell") {
      const hasSpell = actor.spells?.[prereq.spellId] === true;
      if (!hasSpell) {
        return {
          valid: false,
          reason: `Requires spell ${prereq.spellId}`,
        };
      }
    } else if (prereq.type === "notHasTalentWithParam") {
      // Check if actor already has this talent with the specified param value
      // Used to prevent taking same Resistance type or Casting Specialization twice
      const talentParams = (actor as any).talentParams?.[prereq.talentId];
      if (talentParams && talentParams[prereq.paramKey] === prereq.paramValue) {
        return {
          valid: false,
          reason: `Already has ${prereq.talentId} with ${prereq.paramKey}=${prereq.paramValue}`,
        };
      }
    }
  }
  return { valid: true };
}

/**
 * Checks if actor has already acquired a talent with given uniqueness key
 * Used for talents like Resistance (Type) that can only be taken once per type
 */
export function hasAcquiredTalentWithUniquenessKey(
  actor: Actor,
  uniquenessKey: string,
  chosenParamValue?: string
): boolean {
  // Resolve the uniqueness key with the chosen param
  const resolvedKey = chosenParamValue 
    ? uniquenessKey.replace(/<[^>]+>/g, chosenParamValue)
    : uniquenessKey;
  
  // Check talentUniquenessKeys on actor
  const uniquenessKeys = (actor as any).talentUniquenessKeys as string[] | undefined;
  return uniquenessKeys?.includes(resolvedKey) ?? false;
}

/**
 * Gets the resolved uniqueness key for a talent with chosen params
 */
export function resolveTalentUniquenessKey(
  talent: Talent,
  chosenParams?: TalentParams
): string | null {
  if (!talent.uniquenessKey) return null;
  
  let key = talent.uniquenessKey;
  if (talent.chosenParam && chosenParams) {
    const paramValue = chosenParams[talent.chosenParam.paramKey];
    if (typeof paramValue === "string") {
      key = key.replace(`<${talent.chosenParam.paramKey}>`, paramValue);
    }
  }
  return key;
}

/**
 * Checks if actor has a trait
 */
export function hasTrait(actor: Actor, traitId: string, save?: GameSave): boolean {
  if (actor.traits[traitId] !== undefined) return true;
  if (!save || !actor.equipment || !save.itemsById) return false;
  const equippedItems = [
    actor.equipment.mainHand,
    actor.equipment.offHand,
    actor.equipment.armor,
    actor.equipment.helmet,
    actor.equipment.boots,
    actor.equipment.cloak,
    actor.equipment.necklace,
    actor.equipment.ring1,
    actor.equipment.ring2,
  ];
  for (const itemRef of equippedItems) {
    if (!itemRef || (itemRef.kind !== "item" && itemRef.kind !== "misc")) continue;
    const item = save.itemsById[itemRef.id];
    if (!item?.grants) continue;
    for (const grant of item.grants) {
      if (grant.type === "trait" && grant.traitId === traitId) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks if actor has a talent with at least minRank
 */
export function hasTalentRank(actor: Actor, talentId: string, minRank: number = 1): boolean {
  const rank = actor.talents[talentId] ?? 0;
  return rank >= minRank;
}

/**
 * Checks if actor has a specific talent
 */
export function hasTalent(actor: Actor, talentId: string): boolean {
  return hasTalentRank(actor, talentId, 1);
}

/**
 * Checks if actor has a stat at least at value
 */
export function statAtLeast(save: GameSave, actor: Actor, statKey: string, value: number): boolean {
  const statValue = getCharacteristicValue(actor.id, statKey as any, save);
  return statValue >= value;
}

/**
 * Gets all talent params for an actor's talent
 */
export function getTalentParams(actor: Actor, talentId: string): TalentParams | undefined {
  return (actor as any).talentParams?.[talentId];
}

/**
 * Checks if an actor can acquire a trait (used by character builders)
 */
export function canAcquireTrait(actor: Actor, traitId: string): { valid: boolean; reason?: string } {
  if (traitId === "trait:weaver" && actor.traits?.["trait:untouchable"] !== undefined) {
    return {
      valid: false,
      reason: "Cannot acquire trait:weaver while trait:untouchable is present",
    };
  }
  return { valid: true };
}
/**
 * Gets all acquired talents with their params for an actor
 */
export function getActorTalentsWithParams(actor: Actor): Array<{ talentId: string; rank: number; params?: TalentParams }> {
  const result: Array<{ talentId: string; rank: number; params?: TalentParams }> = [];
  for (const [talentId, rank] of Object.entries(actor.talents)) {
    if (rank >= 1) {
      result.push({
        talentId,
        rank,
        params: getTalentParams(actor, talentId),
      });
    }
  }
  return result;
}

/**
 * Checks if an actor can acquire a talent
 * Returns success/failure with detailed reason
 * XP is checked from actor.resources.xp (per-actor XP)
 */
export function canAcquireTalent(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actor: Actor,
  talent: Talent,
  chosenParams?: TalentParams
): { canAcquire: boolean; reason?: string } {
  // Check current rank vs max rank
  const currentRank = actor.talents[talent.id] ?? 0;
  const maxRank = talent.maxRank ?? 1;
  
  if (currentRank >= maxRank) {
    return { canAcquire: false, reason: "Already at max rank" };
  }

  // Check XP (per-actor XP from actor.resources.xp)
  const actorXp = actor.resources.xp ?? 0;
  if (actorXp < talent.xpCost) {
    return { canAcquire: false, reason: `Need ${talent.xpCost} XP (have ${actorXp})` };
  }

  // Check prerequisites
  const prereqResult = evaluatePrerequisites(save, catalogs, actor, talent.prerequisites);
  if (!prereqResult.valid) {
    return { canAcquire: false, reason: prereqResult.reason };
  }

  // Check uniqueness key (for repeatable talents with choices)
  if (talent.uniquenessKey && chosenParams) {
    const paramKey = talent.chosenParam?.paramKey || "";
    const chosenValue = chosenParams[paramKey];
    if (typeof chosenValue === "string") {
      const alreadyHas = hasAcquiredTalentWithUniquenessKey(actor, talent.uniquenessKey, chosenValue);
      if (alreadyHas) {
        return { canAcquire: false, reason: `Already acquired with ${chosenValue}` };
      }
    }
  }

  return { canAcquire: true };
}
