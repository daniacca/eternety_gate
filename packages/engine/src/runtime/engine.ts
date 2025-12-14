import type {
  StoryPack,
  GameSave,
  Party,
  Actor,
  Scene,
  Choice,
  SceneId,
  ChoiceId,
  ActorId,
  Item,
  ItemId,
  Check,
  MagicChannelCheck,
  MagicEffectCheck,
} from './types';
import { evaluateConditions } from './conditions';
import { applyEffects, applyEffect } from './effects';
import { performCheck } from './checks';
import { RNG } from './rng';

/**
 * Updates magic state based on check result
 */
function updateMagicState(
  check: Check,
  result: NonNullable<ReturnType<typeof performCheck>>,
  save: GameSave
): GameSave {
  if (check.kind === 'magicChannel' && result.success) {
    const magicCheck = check as MagicChannelCheck;
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

  if (check.kind === 'magicEffect' && result.success) {
    const magicCheck = check as MagicEffectCheck;
    const currentMagic = save.runtime.magic || { accumulatedDoS: 0 };
    const requiredDoS = magicCheck.castingNumberDoS;
    
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
 * Creates a new game save from a story pack
 */
export function createNewGame(
  storyPack: StoryPack,
  saveSeed: number,
  party: Party,
  actorsById: Record<ActorId, Actor>,
  itemCatalogById: Record<ItemId, Item>
): GameSave {
  const save: GameSave = {
    saveVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    story: {
      id: storyPack.id,
      version: storyPack.version,
    },
    state: {
      flags: { ...storyPack.initialState.flags },
      counters: { ...storyPack.initialState.counters },
      inventory: {
        items: [...(storyPack.initialState.inventory?.items || [])],
      },
      runVariant: storyPack.initialState.runVariant,
    },
    party,
    actorsById,
    itemCatalogById,
    runtime: {
      currentSceneId: storyPack.startSceneId,
      rngSeed: saveSeed,
      rngCounter: 0,
      history: {
        visitedScenes: [],
        chosenChoices: [],
      },
      firedWorldEvents: [],
      magic: {
        accumulatedDoS: 0,
      },
    },
  };

  return save;
}

/**
 * Gets the current scene and resolved text blocks
 */
export function getCurrentScene(
  storyPack: StoryPack,
  save: GameSave
): { scene: Scene; text: string[] } {
  const scene = storyPack.scenes.find(s => s.id === save.runtime.currentSceneId);
  if (!scene) {
    throw new Error(`Scene not found: ${save.runtime.currentSceneId}`);
  }

  // Start with base text
  const text: string[] = [...scene.text];

  // Add conditional text blocks
  if (scene.textBlocks) {
    for (const block of scene.textBlocks) {
      if (evaluateConditions(block.conditions, save)) {
        text.push(...block.text);
      }
    }
  }

  return { scene, text };
}

/**
 * Lists available choices for the current scene, filtered by conditions
 */
export function listAvailableChoices(
  storyPack: StoryPack,
  save: GameSave
): Choice[] {
  const { scene } = getCurrentScene(storyPack, save);

  return scene.choices.filter(choice => {
    if (!choice.conditions) {
      return true;
    }
    return evaluateConditions(choice.conditions, save);
  });
}

/**
 * Applies a choice and returns the updated save
 */
export function applyChoice(
  storyPack: StoryPack,
  save: GameSave,
  choiceId: ChoiceId
): GameSave {
  const { scene } = getCurrentScene(storyPack, save);
  const choice = scene.choices.find(c => c.id === choiceId);

  if (!choice) {
    throw new Error(`Choice not found: ${choiceId}`);
  }

  // Check conditions again
  if (choice.conditions) {
    if (!evaluateConditions(choice.conditions, save)) {
      throw new Error(`Choice conditions not met: ${choiceId}`);
    }
  }

  // Create RNG from save state
  const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);

  let currentSave = { ...save };

  // Apply scene onEnter effects if this is first visit
  if (!currentSave.runtime.history.visitedScenes.includes(scene.id)) {
    if (scene.onEnter) {
      currentSave = applyEffects(scene.onEnter, storyPack, currentSave, rng);
    }
  }

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

        if (result.success && check.onSuccess) {
          currentSave = applyEffects(check.onSuccess, storyPack, currentSave, rng);
        } else if (!result.success && check.onFailure) {
          currentSave = applyEffects(check.onFailure, storyPack, currentSave, rng);
        }
      }
    }
  }

  // Execute choice checks if any
  if (choice.checks) {
    for (const check of choice.checks) {
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

        if (result.success && check.onSuccess) {
          currentSave = applyEffects(check.onSuccess, storyPack, currentSave, rng);
        } else if (!result.success && check.onFailure) {
          currentSave = applyEffects(check.onFailure, storyPack, currentSave, rng);
        }
      }
    }
  }

  // Apply choice effects
  currentSave = applyEffects(choice.effects, storyPack, currentSave, rng);

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
}

