import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getTalentById } from "../../content/loadCatalogs";
import { evaluatePrerequisites } from "./prerequisites";
import { applyGrants } from "./grants";

/**
 * Gets current XP from save
 */
export function getXp(save: GameSave): number {
  return save.meta?.xp ?? 0;
}

/**
 * Adds XP to save
 */
export function addXp(save: GameSave, amount: number): GameSave {
  const currentXp = getXp(save);
  return {
    ...save,
    meta: {
      ...save.meta,
      xp: currentXp + amount,
    },
  };
}

/**
 * Spends XP from save
 * Throws error if insufficient XP
 */
export function spendXp(save: GameSave, amount: number): { save: GameSave; error?: string } {
  const currentXp = getXp(save);
  if (currentXp < amount) {
    return {
      save,
      error: `Insufficient XP. Required: ${amount}, Available: ${currentXp}`,
    };
  }
  return {
    save: {
      ...save,
      meta: {
        ...save.meta,
        xp: currentXp - amount,
      },
    },
  };
}

/**
 * Buys a talent for an actor
 * Validates prerequisites, rank cap, spends XP, and applies grants
 */
export function buyTalent(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  talentId: string
): { save: GameSave; error?: string } {
  const actor = save.actorsById[actorId];
  if (!actor) {
    return { save, error: `Actor ${actorId} not found` };
  }

  const talent = getTalentById(catalogs, talentId);
  if (!talent) {
    return { save, error: `Talent ${talentId} not found` };
  }

  // Check current rank
  const currentRank = actor.talents[talentId] ?? 0;
  const maxRank = talent.maxRank ?? 1;
  if (currentRank >= maxRank) {
    return { save, error: `Talent ${talentId} already at max rank ${maxRank}` };
  }

  // Validate prerequisites
  const prereqResult = evaluatePrerequisites(save, catalogs, actor, talent.prerequisites);
  if (!prereqResult.valid) {
    return { save, error: prereqResult.reason || "Prerequisites not met" };
  }

  // Spend XP
  const spendResult = spendXp(save, talent.xpCost);
  if (spendResult.error) {
    return spendResult;
  }

  // Update actor with new talent rank
  const newRank = currentRank + 1;
  const updatedActor = {
    ...actor,
    talents: {
      ...actor.talents,
      [talentId]: newRank,
    },
  };

  // Apply grants
  const updatedSave = applyGrants(
    {
      ...spendResult.save,
      actorsById: {
        ...spendResult.save.actorsById,
        [actorId]: updatedActor,
      },
    },
    catalogs,
    actorId,
    talent.grants
  );

  return { save: updatedSave };
}

