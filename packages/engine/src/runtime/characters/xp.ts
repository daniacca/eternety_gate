import type { GameSave, ActorId, Actor } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getTalentById } from "../../content/loadCatalogs";
import { evaluatePrerequisites, resolveTalentUniquenessKey, TalentParams, getTalentUniquenessRank } from "./prerequisites";
import { applyGrants } from "./grants";

/**
 * Gets current XP for a specific actor
 * XP is stored per-actor in actor.resources.xp
 */
export function getActorXp(save: GameSave, actorId: ActorId): number {
  const actor = save.actorsById[actorId];
  return actor?.resources.xp ?? 0;
}

/**
 * Grants XP to a specific actor
 * XP is stored per-actor in actor.resources.xp
 */
export function grantActorXp(save: GameSave, actorId: ActorId, amount: number): GameSave {
  const actor = save.actorsById[actorId];
  if (!actor) {
    console.warn(`[grantActorXp] Actor not found: ${actorId}`);
    return save;
  }

  const currentXp = actor.resources.xp ?? 0;
  const newXp = currentXp + amount;
  const currentEarned = actor.resources.xpEarned ?? 0;

  const updatedActor: Actor = {
    ...actor,
    resources: {
      ...actor.resources,
      xp: newXp,
      xpEarned: currentEarned + amount,
    },
  };

  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [actorId]: updatedActor,
    },
  };
}

/**
 * Spends XP from a specific actor
 * XP is stored per-actor in actor.resources.xp
 * Returns error if insufficient XP
 */
export function spendActorXp(save: GameSave, actorId: ActorId, amount: number): { save: GameSave; error?: string } {
  const actor = save.actorsById[actorId];
  if (!actor) {
    return { save, error: `Actor ${actorId} not found` };
  }

  const currentXp = actor.resources.xp ?? 0;
  if (currentXp < amount) {
    return {
      save,
      error: `Insufficient XP. Required: ${amount}, Available: ${currentXp}`,
    };
  }

  const updatedActor: Actor = {
    ...actor,
    resources: {
      ...actor.resources,
      xp: currentXp - amount,
      xpSpent: (actor.resources.xpSpent ?? 0) + amount,
    },
  };

  return {
    save: {
      ...save,
      actorsById: {
        ...save.actorsById,
        [actorId]: updatedActor,
      },
    },
  };
}

/**
 * Buys a talent for an actor
 * Validates prerequisites, rank cap, spends XP from actor, and applies grants
 * XP is stored per-actor in actor.resources.xp
 */
export function buyTalent(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  talentId: string,
  chosenParams?: TalentParams
): { save: GameSave; error?: string } {
  const actor = save.actorsById[actorId];
  if (!actor) {
    return { save, error: `Actor ${actorId} not found` };
  }

  const talent = getTalentById(catalogs, talentId);
  if (!talent) {
    return { save, error: `Talent ${talentId} not found` };
  }

  const currentRank = actor.talents[talentId] ?? 0;
  const maxRank = talent.maxRank ?? 1;

  if (talent.chosenParam && (!chosenParams || Object.keys(chosenParams).length === 0)) {
    return { save, error: `Talent ${talentId} requires a specialization selection` };
  }

  if (talent.uniquenessKey && chosenParams) {
    const resolvedKey = resolveTalentUniquenessKey(talent, chosenParams);
    if (!resolvedKey) {
      return { save, error: `Talent ${talentId} requires a specialization selection` };
    }
    const uniqueRank = getTalentUniquenessRank(actor, talentId, resolvedKey);
    if (uniqueRank >= maxRank) {
      return { save, error: `Talent ${talentId} already at max rank for specialization` };
    }
  } else if (currentRank >= maxRank) {
    return { save, error: `Talent ${talentId} already at max rank ${maxRank}` };
  }

  // Validate prerequisites
  const prereqResult = evaluatePrerequisites(save, catalogs, actor, talent.prerequisites, chosenParams);
  if (!prereqResult.valid) {
    return { save, error: prereqResult.reason || "Prerequisites not met" };
  }

  // Spend XP from actor
  const spendResult = spendActorXp(save, actorId, talent.xpCost);
  if (spendResult.error) {
    return spendResult;
  }

  // Update actor with new talent rank
  let newRank = currentRank + 1;
  let updatedActor: any = {
    ...spendResult.save.actorsById[actorId],
    talents: {
      ...spendResult.save.actorsById[actorId].talents,
      [talentId]: newRank,
    },
  };

  if (talent.uniquenessKey && chosenParams) {
    const resolvedKey = resolveTalentUniquenessKey(talent, chosenParams);
    if (!resolvedKey) {
      return { save: spendResult.save, error: `Talent ${talentId} requires a specialization selection` };
    }

    const existingParamsById = (updatedActor as any).talentParamsById || {};
    const existingParamsForTalent = existingParamsById[talentId] || {};
    const existingRanksById = (updatedActor as any).talentUniquenessRanksById || {};
    const existingRanksForTalent = existingRanksById[talentId] || {};
    const existingKeys = ((updatedActor as any).talentUniquenessKeys as string[]) || [];

    updatedActor = {
      ...updatedActor,
      talentParamsById: {
        ...existingParamsById,
        [talentId]: {
          ...existingParamsForTalent,
          [resolvedKey]: chosenParams,
        },
      },
      talentUniquenessRanksById: {
        ...existingRanksById,
        [talentId]: {
          ...existingRanksForTalent,
          [resolvedKey]: (existingRanksForTalent[resolvedKey] ?? 0) + 1,
        },
      },
      talentUniquenessKeys: existingKeys.includes(resolvedKey) ? existingKeys : [...existingKeys, resolvedKey],
    };
  } else if (chosenParams && Object.keys(chosenParams).length > 0) {
    const existingParams = (updatedActor as any).talentParams || {};
    updatedActor = {
      ...updatedActor,
      talentParams: {
        ...existingParams,
        [talentId]: chosenParams,
      },
    };
  }

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
