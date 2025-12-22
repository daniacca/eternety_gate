import type { Choice, StoryPack, GameSave, Check } from "../types";
import type { IRNG } from "../rng";
import type { ChoiceHandler } from "./types";
import { performCheck } from "../checks";
import { applyEffects } from "../effects";
import { getCurrentScene } from "../selectors";

/**
 * Updates magic state based on check result
 */
function updateMagicState(
  check: Check,
  result: NonNullable<ReturnType<typeof performCheck>>,
  save: GameSave
): GameSave {
  if (check.kind === "magicChannel" && result.success) {
    const currentMagic = save.runtime.magic || { accumulatedDoS: 0 };
    return {
      ...save,
      runtime: {
        ...save.runtime,
        magic: {
          accumulatedDoS: currentMagic.accumulatedDoS + result.dos,
        },
      },
    };
  }

  if (check.kind === "magicEffect" && result.success) {
    const currentMagic = save.runtime.magic || { accumulatedDoS: 0 };
    const requiredDoS = (check as any).castingNumberDoS;

    // Magic effect requires accumulated DoS >= CN and roll DoS >= CN
    if (result.dos >= requiredDoS && currentMagic.accumulatedDoS >= requiredDoS) {
      return {
        ...save,
        runtime: {
          ...save.runtime,
          magic: {
            accumulatedDoS: Math.max(0, currentMagic.accumulatedDoS - requiredDoS),
          },
        },
      };
    }
  }

  return save;
}

/**
 * Handles choices with non-combat checks (performCheck, lastCheck, tags, etc.)
 */
export const handleCheckChoice: ChoiceHandler = (
  choice: Choice,
  choiceId: string,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): GameSave => {
  const { scene } = getCurrentScene(storyPack, save);
  let currentSave = { ...save };

  // Execute scene checks if any
  if (scene.checks) {
    for (const check of scene.checks) {
      const result = performCheck(check, storyPack, currentSave, rng);
      if (result) {
        currentSave = {
          ...currentSave,
          runtime: {
            ...currentSave.runtime,
            lastCheck: result,
            rngCounter: rng.getCounter(),
          },
        };

        // Update magic state if needed
        currentSave = updateMagicState(check, result, currentSave);

        // Standard check effects
        if (result.success && check.onSuccess) {
          currentSave = applyEffects(check.onSuccess, storyPack, currentSave, rng);
        } else if (!result.success && check.onFailure) {
          currentSave = applyEffects(check.onFailure, storyPack, currentSave, rng);
        }
      }
    }
  }

  // Execute choice checks if any
  // Stop on first failure (after applying onFailure effects)
  if (choice.checks) {
    for (const check of choice.checks) {
      const result = performCheck(check, storyPack, currentSave, rng);
      if (!result) {
        // If check returns null, skip it
        continue;
      }

      // Store check result
      currentSave = {
        ...currentSave,
        runtime: {
          ...currentSave.runtime,
          lastCheck: result,
          rngCounter: rng.getCounter(),
        },
      };

      // Update magic state if needed
      currentSave = updateMagicState(check, result, currentSave);

      // Standard check effects
      if (result.success && check.onSuccess) {
        currentSave = applyEffects(check.onSuccess, storyPack, currentSave, rng);
      } else if (!result.success) {
        // On failure, apply onFailure effects and stop further checks
        if (check.onFailure) {
          currentSave = applyEffects(check.onFailure, storyPack, currentSave, rng);
        }
        // Stop processing further checks on failure
        break;
      }
    }
  }

  // Track visited scenes before applying effects (to check if we're entering a new scene)
  const visitedScenesBefore = [...currentSave.runtime.history.visitedScenes];

  // Apply choice effects (may include goto)
  currentSave = applyEffects(choice.effects, storyPack, currentSave, rng);

  // Apply scene onEnter effects for the new scene if this is first visit
  const newSceneId = currentSave.runtime.currentSceneId;
  if (!visitedScenesBefore.includes(newSceneId)) {
    const newScene = storyPack.scenes.find((s) => s.id === newSceneId);
    if (newScene && newScene.onEnter) {
      currentSave = applyEffects(newScene.onEnter, storyPack, currentSave, rng);
    }
  }

  // Update history
  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      rngCounter: rng.getCounter(),
      history: {
        ...currentSave.runtime.history,
        chosenChoices: [...currentSave.runtime.history.chosenChoices, choiceId],
      },
    },
    updatedAt: new Date().toISOString(),
  };

  return currentSave;
};
