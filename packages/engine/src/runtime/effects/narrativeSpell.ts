import type { Effect, GameSave, StoryPack } from "../types";
import type { IRNG } from "../rng";
import { runNarrativeSpell } from "../magic/castSpellNarrative";
import { loadCharacterCatalogs } from "../../content/loadCatalogs";
import type { CharacterCatalogs } from "../../content/catalogs";
import { appendCombatLog } from "../combat/narration";

/**
 * Handles the narrativeSpell effect - casts a spell in narrative context via effect system
 */
export function handleNarrativeSpell(
  effect: Extract<Effect, { op: "narrativeSpell" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  // Load catalogs for character calculations
  const catalogs: CharacterCatalogs | undefined =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;

  // Prepare narrative spell request
  const request = {
    spellId: effect.spellId,
    casterId: effect.casterId ?? save.party.activeActorId,
    targetActorId: effect.targetActorId,
    context: {
      sceneId: save.runtime.currentSceneId,
    },
  };

  // Run narrative spell
  const { save: afterSpellSave, result } = runNarrativeSpell(
    save,
    request,
    rng,
    catalogs
  );

  let updatedSave = afterSpellSave;

  // Add spell logs to combatLog (narrative log channel)
  for (const log of result.logs) {
    updatedSave = appendCombatLog(updatedSave, log);
  }

  // Persist RNG counter
  if (typeof (rng as any).getCounter === "function") {
    updatedSave = {
      ...updatedSave,
      runtime: {
        ...updatedSave.runtime,
        rngCounter: (rng as any).getCounter(),
      },
    };
  }

  return { save: updatedSave };
}
