import type { GameSave, ActorId, Actor } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { evaluatePrerequisites } from "../characters/prerequisites";
import { spendXp } from "../characters/xp";
import { getSpellById } from "./catalogs";
import type { SpellDefinition } from "./types";

/**
 * Checks if an actor can learn a spell
 */
export function canLearnSpell(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  spellId: string
): { canLearn: boolean; reason?: string } {
  const actor = save.actorsById[actorId];
  if (!actor) {
    return { canLearn: false, reason: "Actor not found" };
  }

  const spell = getSpellById(spellId);
  if (!spell) {
    return { canLearn: false, reason: "Spell not found" };
  }

  // Check if already learned
  if (actor.spells?.[spellId]) {
    return { canLearn: false, reason: "Spell already learned" };
  }

  // Check XP
  const currentXp = save.meta?.xp ?? 0;
  if (currentXp < spell.xpCost) {
    return { canLearn: false, reason: `Insufficient XP (need ${spell.xpCost}, have ${currentXp})` };
  }

  // Check prerequisites
  if (spell.prerequisites && spell.prerequisites.length > 0) {
    const prereqResult = evaluatePrerequisites(save, catalogs, actor, spell.prerequisites);
    if (!prereqResult.valid) {
      return { canLearn: false, reason: prereqResult.reason || "Prerequisites not met" };
    }
  }

  return { canLearn: true };
}

/**
 * Learns a spell for an actor
 * Validates prerequisites, spends XP, and adds spell to actor.spells
 */
export function learnSpell(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  spellId: string
): { save: GameSave; error?: string } {
  const canLearnResult = canLearnSpell(save, catalogs, actorId, spellId);
  if (!canLearnResult.canLearn) {
    return { save, error: canLearnResult.reason || "Cannot learn spell" };
  }

  const spell = getSpellById(spellId);
  if (!spell) {
    return { save, error: "Spell not found" };
  }

  // Spend XP
  const spendResult = spendXp(save, spell.xpCost);
  if (spendResult.error) {
    return spendResult;
  }

  // Update actor with learned spell
  const actor = save.actorsById[actorId];
  const updatedActor: Actor = {
    ...actor,
    spells: {
      ...(actor.spells || {}),
      [spellId]: true,
    },
  };

  return {
    save: {
      ...spendResult.save,
      actorsById: {
        ...spendResult.save.actorsById,
        [actorId]: updatedActor,
      },
    },
  };
}

/**
 * Gets all learned spells for an actor
 */
export function getLearnedSpells(
  save: GameSave,
  actorId: ActorId,
  catalogs?: CharacterCatalogs
): SpellDefinition[] {
  const actor = save.actorsById[actorId];
  if (!actor || !actor.spells) {
    return [];
  }

  const learnedSpellIds = Object.keys(actor.spells).filter((id) => actor.spells![id] === true);
  return learnedSpellIds.map((id) => getSpellById(id)).filter((s): s is SpellDefinition => s !== undefined);
}

/**
 * Checks if an actor has learned a spell
 */
export function hasLearnedSpell(actor: Actor, spellId: string): boolean {
  return actor.spells?.[spellId] === true;
}

