import type {
  Effect,
  GameSave,
  StoryPack,
  Condition,
  SceneId,
  ItemId,
  WorldEventId,
} from './types';
import { evaluateCondition, evaluateConditions } from './conditions';
import { RNG } from './rng';
import { performCheck } from './checks';

/**
 * Applies an effect to the game save (immutably)
 */
export function applyEffect(
  effect: Effect,
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): GameSave {
  switch (effect.op) {
    case 'setFlag':
      return applySetFlag(effect, save);

    case 'addCounter':
      return applyAddCounter(effect, save);

    case 'addItem':
      return applyAddItem(effect, save);

    case 'removeItem':
      return applyRemoveItem(effect, save);

    case 'goto':
      return applyGoto(effect, save);

    case 'conditionalEffects':
      return applyConditionalEffects(effect, storyPack, save, rng);

    case 'chooseRunVariant':
      return applyChooseRunVariant(effect, storyPack, save, rng);

    case 'applyVariantStartEffects':
      return applyVariantStartEffects(storyPack, save, rng);

    case 'fireWorldEvents':
      return applyFireWorldEvents(storyPack, save, rng);

    default:
      return save;
  }
}

/**
 * Applies multiple effects in sequence
 */
export function applyEffects(
  effects: Effect[],
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): GameSave {
  let currentSave = save;
  for (const effect of effects) {
    currentSave = applyEffect(effect, storyPack, currentSave, rng);
  }
  return currentSave;
}

function applySetFlag(
  effect: Extract<Effect, { op: 'setFlag' }>,
  save: GameSave
): GameSave {
  const newFlags = { ...save.state.flags };
  setNestedValue(newFlags, effect.path, effect.value);

  return {
    ...save,
    state: {
      ...save.state,
      flags: newFlags,
    },
  };
}

function applyAddCounter(
  effect: Extract<Effect, { op: 'addCounter' }>,
  save: GameSave
): GameSave {
  const newCounters = { ...save.state.counters };
  const currentValue = getNestedValue(newCounters, effect.path) || 0;
  setNestedValue(newCounters, effect.path, currentValue + effect.value);

  return {
    ...save,
    state: {
      ...save.state,
      counters: newCounters,
    },
  };
}

function applyAddItem(
  effect: Extract<Effect, { op: 'addItem' }>,
  save: GameSave
): GameSave {
  const newInventory = {
    ...save.state.inventory,
    items: [...save.state.inventory.items, effect.itemId],
  };

  return {
    ...save,
    state: {
      ...save.state,
      inventory: newInventory,
    },
  };
}

function applyRemoveItem(
  effect: Extract<Effect, { op: 'removeItem' }>,
  save: GameSave
): GameSave {
  const newInventory = {
    ...save.state.inventory,
    items: save.state.inventory.items.filter(id => id !== effect.itemId),
  };

  return {
    ...save,
    state: {
      ...save.state,
      inventory: newInventory,
    },
  };
}

function applyGoto(
  effect: Extract<Effect, { op: 'goto' }>,
  save: GameSave
): GameSave {
  const newHistory = {
    ...save.runtime.history,
    visitedScenes: [...save.runtime.history.visitedScenes, save.runtime.currentSceneId],
  };

  return {
    ...save,
    runtime: {
      ...save.runtime,
      currentSceneId: effect.sceneId,
      history: newHistory,
    },
  };
}

function applyConditionalEffects(
  effect: Extract<Effect, { op: 'conditionalEffects' }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): GameSave {
  for (const case_ of effect.cases) {
    if (evaluateCondition(case_.when, save)) {
      return applyEffects(case_.then, storyPack, save, rng);
    }
  }
  return save;
}

function applyChooseRunVariant(
  effect: Extract<Effect, { op: 'chooseRunVariant' }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): GameSave {
  const variants = storyPack.systems.runVariants || [];
  if (variants.length === 0) {
    return save;
  }

  let selectedVariant: typeof variants[0] | null = null;

  switch (effect.strategy) {
    case 'randomOrDefault': {
      const defaultVariant = variants.find(v => v.id === 'VAR_DEFAULT');
      if (defaultVariant) {
        selectedVariant = defaultVariant;
      } else if (variants.length > 0) {
        selectedVariant = variants[rng.nextInt(0, variants.length - 1)];
      }
      break;
    }

    case 'random': {
      if (variants.length > 0) {
        selectedVariant = variants[rng.nextInt(0, variants.length - 1)];
      }
      break;
    }

    case 'defaultOnly': {
      selectedVariant = variants.find(v => v.id === 'VAR_DEFAULT') || null;
      break;
    }
  }

  if (selectedVariant) {
    const newState = {
      ...save.state,
      runVariant: {
        id: selectedVariant.id,
        tags: selectedVariant.tags || [],
      },
    };

    return {
      ...save,
      state: newState,
    };
  }

  return save;
}

function applyVariantStartEffects(
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): GameSave {
  const variantId = save.state.runVariant?.id;
  if (!variantId) {
    return save;
  }

  const variants = storyPack.systems.runVariants || [];
  const variant = variants.find(v => v.id === variantId);
  if (!variant || !variant.startEffects) {
    return save;
  }

  return applyEffects(variant.startEffects, storyPack, save, rng);
}

function applyFireWorldEvents(
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): GameSave {
  const worldEvents = storyPack.systems.worldEvents || {};
  let currentSave = save;

  for (const [eventId, event] of Object.entries(worldEvents)) {
    // Skip if already fired and it's a once event
    if (event.once && currentSave.runtime.firedWorldEvents.includes(eventId)) {
      continue;
    }

    // Check trigger condition
    if (evaluateCondition(event.trigger, currentSave)) {
      // Fire the event
      currentSave = applyEffects(event.effects, storyPack, currentSave, rng);

      // Mark as fired
      const newFiredEvents = [...currentSave.runtime.firedWorldEvents, eventId];
      currentSave = {
        ...currentSave,
        runtime: {
          ...currentSave.runtime,
          firedWorldEvents: newFiredEvents,
        },
      };
    }
  }

  return currentSave;
}

/**
 * Gets a nested value from an object using dot notation path
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
  const parts = path.split('.');
  let current: any = obj;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Sets a nested value in an object using dot notation path
 */
function setNestedValue(obj: Record<string, any>, path: string, value: any): void {
  const parts = path.split('.');
  let current: any = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

