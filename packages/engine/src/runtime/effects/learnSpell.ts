import type { Effect, GameSave, StoryPack } from "../types";
import { canLearnSpell, learnSpell } from "../magic/learning";
import { loadCharacterCatalogs } from "../../content/loadCatalogs";
import { appendRuntimeLog } from "../combat/narration";
import { getSpellById } from "../magic/catalogs";

/**
 * Learn Spell effect handler
 * Validates prerequisites, spends XP, and adds spell to actor.spells
 */
export function handleLearnSpell(
  effect: Extract<Effect, { op: "learnSpell" }>,
  storyPack: StoryPack,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return { save };
  }

  // Load catalogs
  const catalogs = loadCharacterCatalogs({
    id: storyPack.id,
    weapons: storyPack.weapons || [],
    armors: storyPack.armors || [],
    skills: storyPack.skills || [],
    talents: storyPack.talents || [],
    traits: storyPack.traits || [],
  });

  // Validate can learn spell
  const canLearnResult = canLearnSpell(save, catalogs, effect.actorId, effect.spellId);
  if (!canLearnResult.canLearn) {
    // Log error but don't fail - just return unchanged save
    return {
      save: appendRuntimeLog(save, {
        kind: "system",
        message: `Impossibile imparare l'incantesimo: ${canLearnResult.reason || "errore sconosciuto"}`,
      }),
    };
  }

  // Learn spell (this validates again, spends XP, and updates actor)
  const result = learnSpell(save, catalogs, effect.actorId, effect.spellId);
  if (result.error) {
    return {
      save: appendRuntimeLog(save, {
        kind: "system",
        message: `Errore nell'imparare l'incantesimo: ${result.error}`,
      }),
    };
  }

  // Log success
  const spell = getSpellById(effect.spellId);
  const spellName = spell?.name || effect.spellId;
  const updatedSave = appendRuntimeLog(result.save, {
    kind: "system",
    message: `${actor.name} ha imparato l'incantesimo: ${spellName}`,
  });

  return { save: updatedSave };
}
