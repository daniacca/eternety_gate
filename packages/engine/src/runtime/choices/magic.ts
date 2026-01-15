import type { Choice, StoryPack, GameSave } from "../types";
import type { IRNG } from "../rng";
import type { ContentPack } from "../../content/types";
import type { MagicChoice } from "./types";
import { runNarrativeSpell, applyNarrativeOps } from "../magic/castSpellNarrative";
import { applyEffects } from "../effects";
import { loadCharacterCatalogs } from "../../content/loadCatalogs";
import type { CharacterCatalogs } from "../../content/catalogs";
import { appendCombatLog } from "../combat/narration";

/**
 * Handles a magic choice - performs narrative spell casting and applies story consequences
 * 
 * Gating: If spell is not known or usage.narrative is false, the choice fails cleanly
 * with a clear message logged, and no save modifications beyond logs/lastCheck.
 */
export function handleMagicChoice(
  choice: Choice,
  choiceId: string,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG,
  contentPack?: ContentPack
): GameSave {
  const magicChoice = choice as MagicChoice;
  const spellId = magicChoice.spellId;

  if (!spellId) {
    // No spell ID - fall back to regular choice processing
    return save;
  }

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
    spellId,
    casterId: save.party.activeActorId,
    targetActorId: magicChoice.magicTarget?.actorId,
    context: {
      sceneId: save.runtime.currentSceneId,
      choiceId,
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

  // Record choice in history
  updatedSave = {
    ...updatedSave,
    runtime: {
      ...updatedSave.runtime,
      history: {
        ...updatedSave.runtime.history,
        chosenChoices: [...updatedSave.runtime.history.chosenChoices, choiceId],
      },
    },
  };

  // If the spell cast failed due to gating (not known, not allowed for narrative, etc.),
  // return early with only logs and lastCheck updated
  if (!result.ok) {
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
    return updatedSave;
  }

  // Determine success based on spell result and minDoS
  const minDoS = magicChoice.minDoS ?? 0;
  const effectiveDoS = result.check?.dos ?? 0;
  const isSuccess = result.success && effectiveDoS >= minDoS;

  // Apply story-level consequences based on success/failure
  if (isSuccess && magicChoice.onMagicSuccess) {
    const successConfig = magicChoice.onMagicSuccess;

    // Set flags
    if (successConfig.setFlags) {
      for (const [key, value] of Object.entries(successConfig.setFlags)) {
        updatedSave = {
          ...updatedSave,
          state: {
            ...updatedSave.state,
            flags: {
              ...updatedSave.state.flags,
              [key]: value,
            },
          },
        };
      }
    }

    // Apply narrativeOps (if any)
    if (successConfig.narrativeOps && successConfig.narrativeOps.length > 0) {
      const { save: afterOpsSave, emittedLogs } = applyNarrativeOps(
        updatedSave,
        successConfig.narrativeOps,
        { dos: effectiveDoS, catalogs }
      );
      updatedSave = afterOpsSave;
      for (const log of emittedLogs) {
        updatedSave = appendCombatLog(updatedSave, log);
      }
    }

    // Goto scene
    if (successConfig.goto) {
      updatedSave = {
        ...updatedSave,
        runtime: {
          ...updatedSave.runtime,
          currentSceneId: successConfig.goto,
          history: {
            ...updatedSave.runtime.history,
            visitedScenes: [
              ...updatedSave.runtime.history.visitedScenes,
              successConfig.goto,
            ],
          },
        },
      };
    }
  } else if (!isSuccess && magicChoice.onMagicFailure) {
    const failureConfig = magicChoice.onMagicFailure;

    // Set flags
    if (failureConfig.setFlags) {
      for (const [key, value] of Object.entries(failureConfig.setFlags)) {
        updatedSave = {
          ...updatedSave,
          state: {
            ...updatedSave.state,
            flags: {
              ...updatedSave.state.flags,
              [key]: value,
            },
          },
        };
      }
    }

    // Apply narrativeOps (if any)
    if (failureConfig.narrativeOps && failureConfig.narrativeOps.length > 0) {
      const { save: afterOpsSave, emittedLogs } = applyNarrativeOps(
        updatedSave,
        failureConfig.narrativeOps,
        { dos: effectiveDoS, catalogs }
      );
      updatedSave = afterOpsSave;
      for (const log of emittedLogs) {
        updatedSave = appendCombatLog(updatedSave, log);
      }
    }

    // Goto scene
    if (failureConfig.goto) {
      updatedSave = {
        ...updatedSave,
        runtime: {
          ...updatedSave.runtime,
          currentSceneId: failureConfig.goto,
          history: {
            ...updatedSave.runtime.history,
            visitedScenes: [
              ...updatedSave.runtime.history.visitedScenes,
              failureConfig.goto,
            ],
          },
        },
      };
    }
  }

  // Apply standard choice effects (if any)
  if (choice.effects && choice.effects.length > 0) {
    updatedSave = applyEffects(choice.effects, storyPack, updatedSave, rng, contentPack);
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

  return updatedSave;
}

/**
 * Checks if a choice is a magic choice
 */
export function isMagicChoice(choice: Choice): choice is MagicChoice {
  return "spellId" in choice && typeof (choice as any).spellId === "string";
}
