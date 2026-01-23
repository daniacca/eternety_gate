import type { Effect, GameSave, StoryPack, Actor } from "../types";
import type { CharacterCatalogs, Talent } from "../../content/catalogs";
import { loadCharacterCatalogs, getTalentById } from "../../content/loadCatalogs";
import { evaluatePrerequisites, hasAcquiredTalentWithUniquenessKey, resolveTalentUniquenessKey, TalentParams } from "../characters/prerequisites";
import { getActorXp, spendActorXp, grantActorXp } from "../characters/xp";

/**
 * Handles the acquireTalent effect - learns a talent with optional params
 * 
 * - Validates prerequisites
 * - Validates XP cost (from actor.resources.xp)
 * - Handles uniqueness key enforcement
 * - Stores talent params if needed
 */
export function handleAcquireTalent(
  effect: Extract<Effect, { op: "acquireTalent" }>,
  storyPack: StoryPack,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const { actorId, talentId, chosenParams } = effect;

  const actor = save.actorsById[actorId];
  if (!actor) {
    console.warn(`[acquireTalent] Actor not found: ${actorId}`);
    return { save };
  }

  // Load catalogs
  const catalogs: CharacterCatalogs = loadCharacterCatalogs({
    id: storyPack.id,
    weapons: storyPack.weapons || [],
    armors: storyPack.armors || [],
    skills: storyPack.skills || [],
    talents: storyPack.talents || [],
    traits: storyPack.traits || [],
  });

  // Find talent
  const talent = getTalentById(catalogs, talentId);
  if (!talent) {
    console.warn(`[acquireTalent] Talent not found: ${talentId}`);
    return { save };
  }

  // Check prerequisites
  const prereqResult = evaluatePrerequisites(save, catalogs, actor, talent.prerequisites);
  if (!prereqResult.valid) {
    console.warn(`[acquireTalent] Prerequisites not met: ${prereqResult.reason}`);
    return { save };
  }

  // Check XP cost (from actor, not global)
  const actorXp = getActorXp(save, actorId);
  const currentRank = actor.talents[talentId] ?? 0;
  const maxRank = talent.maxRank ?? 1;

  if (currentRank >= maxRank) {
    console.warn(`[acquireTalent] Talent already at max rank: ${talentId}`);
    return { save };
  }

  if (actorXp < talent.xpCost) {
    console.warn(`[acquireTalent] Not enough XP: actor ${actorId} has ${actorXp}, need ${talent.xpCost}`);
    return { save };
  }

  // Check uniqueness for talents with chosenParam
  if (talent.uniquenessKey && chosenParams) {
    const resolvedKey = resolveTalentUniquenessKey(talent, chosenParams as TalentParams);
    if (resolvedKey) {
      const alreadyHas = hasAcquiredTalentWithUniquenessKey(actor, talent.uniquenessKey, chosenParams[talent.chosenParam?.paramKey || ""] as string);
      if (alreadyHas) {
        console.warn(`[acquireTalent] Already has uniqueness key: ${resolvedKey}`);
        return { save };
      }
    }
  }

  // Spend XP from actor
  const spendResult = spendActorXp(save, actorId, talent.xpCost);
  if (spendResult.error) {
    console.warn(`[acquireTalent] Failed to spend XP: ${spendResult.error}`);
    return { save };
  }

  // Get the updated actor from the save after XP spending
  const actorAfterXp = spendResult.save.actorsById[actorId];

  // Apply the talent acquisition
  const newRank = currentRank + 1;

  // Build updated actor
  let updatedActor: Actor = {
    ...actorAfterXp,
    talents: {
      ...actorAfterXp.talents,
      [talentId]: newRank,
    },
  };

  // Store chosen params if present
  if (chosenParams && Object.keys(chosenParams).length > 0) {
    const existingParams = (actorAfterXp as any).talentParams || {};
    updatedActor = {
      ...updatedActor,
      talentParams: {
        ...existingParams,
        [talentId]: chosenParams,
      },
    } as Actor;
  }

  // Store uniqueness key if present
  if (talent.uniquenessKey && chosenParams) {
    const resolvedKey = resolveTalentUniquenessKey(talent, chosenParams as TalentParams);
    if (resolvedKey) {
      const existingKeys = ((actorAfterXp as any).talentUniquenessKeys as string[]) || [];
      updatedActor = {
        ...updatedActor,
        talentUniquenessKeys: [...existingKeys, resolvedKey],
      } as Actor;
    }
  }

  // Build updated save
  const updatedSave: GameSave = {
    ...spendResult.save,
    actorsById: {
      ...spendResult.save.actorsById,
      [actorId]: updatedActor,
    },
  };

  return { save: updatedSave };
}

/**
 * Handles the grantXp effect - adds XP to a specific actor
 */
export function handleGrantXp(
  effect: Extract<Effect, { op: "grantXp" }>,
  save: GameSave
): { save: GameSave } {
  const { actorId, amount } = effect;
  return {
    save: grantActorXp(save, actorId, amount),
  };
}

/**
 * Handles the grantFatePoint effect - adds Fate Points to an actor
 */
export function handleGrantFatePoint(
  effect: Extract<Effect, { op: "grantFatePoint" }>,
  save: GameSave
): { save: GameSave } {
  const { actorId, amount } = effect;
  const actor = save.actorsById[actorId];
  
  if (!actor) {
    return { save };
  }

  const currentFp = actor.resources.fatePoints ?? 0;
  const newFp = Math.max(0, currentFp + amount);

  const updatedActor: Actor = {
    ...actor,
    resources: {
      ...actor.resources,
      fatePoints: newFp,
      fateProtectionActive: newFp > 0 ? actor.resources.fateProtectionActive : false,
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
