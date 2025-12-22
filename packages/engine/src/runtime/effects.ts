import type { Effect, GameSave, StoryPack } from "./types";
import { evaluateCondition } from "./conditions";
import { IRNG, RNG } from "./rng";
import { combatStart, combatMove, combatEndTurn, combatDefend, combatAim } from "./combat/actions";

/**
 * Effect handler function type
 */
type EffectHandler = (effect: Effect, storyPack: StoryPack, save: GameSave, rng: IRNG) => GameSave;

/**
 * Registry of effect handlers by operation type
 */
const effectHandlers: Record<Effect["op"], EffectHandler> = {
  setFlag: (effect, _storyPack, save, _rng) => applySetFlag(effect as Extract<Effect, { op: "setFlag" }>, save),
  addCounter: (effect, _storyPack, save, _rng) =>
    applyAddCounter(effect as Extract<Effect, { op: "addCounter" }>, save),
  addItem: (effect, _storyPack, save, _rng) => applyAddItem(effect as Extract<Effect, { op: "addItem" }>, save),
  removeItem: (effect, _storyPack, save, _rng) =>
    applyRemoveItem(effect as Extract<Effect, { op: "removeItem" }>, save),
  goto: (effect, _storyPack, save, _rng) => applyGoto(effect as Extract<Effect, { op: "goto" }>, save),
  conditionalEffects: (effect, storyPack, save, rng) =>
    applyConditionalEffects(effect as Extract<Effect, { op: "conditionalEffects" }>, storyPack, save, rng),
  chooseRunVariant: (effect, storyPack, save, rng) =>
    applyChooseRunVariant(effect as Extract<Effect, { op: "chooseRunVariant" }>, storyPack, save, rng),
  applyVariantStartEffects: (_effect, storyPack, save, rng) => applyVariantStartEffects(storyPack, save, rng),
  fireWorldEvents: (_effect, storyPack, save, rng) => applyFireWorldEvents(storyPack, save, rng),
  combatStart: (effect, storyPack, save, _rng) =>
    combatStart(effect as Extract<Effect, { op: "combatStart" }>, storyPack, save),
  combatMove: (effect, _storyPack, save, _rng) => combatMove(effect as Extract<Effect, { op: "combatMove" }>, save),
  combatEndTurn: (effect, storyPack, save, rng) =>
    combatEndTurn(effect as Extract<Effect, { op: "combatEndTurn" }>, storyPack, save, rng),
  combatDefend: (effect, _storyPack, save, _rng) =>
    combatDefend(effect as Extract<Effect, { op: "combatDefend" }>, save),
  combatAim: (effect, _storyPack, save, _rng) => combatAim(effect as Extract<Effect, { op: "combatAim" }>, save),
};

/**
 * Applies an effect to the game save (immutably)
 */
export function applyEffect(effect: Effect, storyPack: StoryPack, save: GameSave, rng: IRNG): GameSave {
  const handler = effectHandlers[effect.op];
  if (handler) {
    return handler(effect, storyPack, save, rng);
  }
  return save;
}

/**
 * Applies multiple effects in sequence
 */
export function applyEffects(effects: Effect[], storyPack: StoryPack, save: GameSave, rng: IRNG): GameSave {
  let currentSave = save;
  for (const effect of effects) {
    currentSave = applyEffect(effect, storyPack, currentSave, rng);
  }
  return currentSave;
}

function applySetFlag(effect: Extract<Effect, { op: "setFlag" }>, save: GameSave): GameSave {
  const newFlags = { ...save.state.flags };
  // Strip 'flags.' prefix if present since we're operating on the flags object
  // After stripping, treat as flat key (no nested path resolution)
  const key = effect.path.startsWith("flags.") ? effect.path.substring(6) : effect.path;
  setFlatValue(newFlags, key, effect.value);

  return {
    ...save,
    state: {
      ...save.state,
      flags: newFlags,
    },
  };
}

function applyAddCounter(effect: Extract<Effect, { op: "addCounter" }>, save: GameSave): GameSave {
  const newCounters = { ...save.state.counters };
  // Strip 'counters.' prefix if present since we're operating on the counters object
  // After stripping, treat as flat key (no nested path resolution)
  const key = effect.path.startsWith("counters.") ? effect.path.substring(9) : effect.path;
  const currentValue = getFlatValue(newCounters, key) || 0;
  setFlatValue(newCounters, key, currentValue + effect.value);

  return {
    ...save,
    state: {
      ...save.state,
      counters: newCounters,
    },
  };
}

function applyAddItem(effect: Extract<Effect, { op: "addItem" }>, save: GameSave): GameSave {
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

function applyRemoveItem(effect: Extract<Effect, { op: "removeItem" }>, save: GameSave): GameSave {
  const newInventory = {
    ...save.state.inventory,
    items: save.state.inventory.items.filter((id) => id !== effect.itemId),
  };

  return {
    ...save,
    state: {
      ...save.state,
      inventory: newInventory,
    },
  };
}

function applyGoto(effect: Extract<Effect, { op: "goto" }>, save: GameSave): GameSave {
  const newSceneId = effect.sceneId;
  const newVisitedScenes = save.runtime.history.visitedScenes.includes(newSceneId)
    ? save.runtime.history.visitedScenes
    : [...save.runtime.history.visitedScenes, newSceneId];

  const isChangingScene = save.runtime.currentSceneId !== newSceneId;
  const combatNotActive = save.runtime.combat?.active !== true;

  // Clear lastCheck and combatEndedSceneId when changing scenes to avoid combat tags persisting
  const clearedLastCheck = isChangingScene ? undefined : save.runtime.lastCheck;
  const clearedCombatEndedSceneId = isChangingScene ? undefined : save.runtime.combatEndedSceneId;

  // Clear combat log state when changing scenes if combat is not active
  const clearedCombatLog = isChangingScene && combatNotActive ? [] : save.runtime.combatLog;
  const clearedCombatTurnStartIndex = isChangingScene && combatNotActive ? 0 : save.runtime.combatTurnStartIndex;
  const clearedCombatLogSceneId = isChangingScene && combatNotActive ? undefined : save.runtime.combatLogSceneId;

  return {
    ...save,
    runtime: {
      ...save.runtime,
      currentSceneId: newSceneId,
      lastCheck: clearedLastCheck,
      combatEndedSceneId: clearedCombatEndedSceneId,
      combatLog: clearedCombatLog,
      combatTurnStartIndex: clearedCombatTurnStartIndex,
      combatLogSceneId: clearedCombatLogSceneId,
      history: {
        ...save.runtime.history,
        visitedScenes: newVisitedScenes,
      },
    },
  };
}

function applyConditionalEffects(
  effect: Extract<Effect, { op: "conditionalEffects" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): GameSave {
  for (const case_ of effect.cases) {
    if (evaluateCondition(case_.when, save)) {
      return applyEffects(case_.then, storyPack, save, rng);
    }
  }
  return save;
}

function applyChooseRunVariant(
  effect: Extract<Effect, { op: "chooseRunVariant" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): GameSave {
  const variants = storyPack.systems.runVariants || [];
  if (variants.length === 0) {
    return save;
  }

  let selectedVariant: (typeof variants)[0] | null = null;

  switch (effect.strategy) {
    case "randomOrDefault": {
      const defaultVariant = variants.find((v) => v.id === "VAR_DEFAULT");
      if (defaultVariant) {
        selectedVariant = defaultVariant;
      } else if (variants.length > 0) {
        selectedVariant = variants[rng.nextInt(0, variants.length - 1)];
      }
      break;
    }

    case "random": {
      if (variants.length > 0) {
        selectedVariant = variants[rng.nextInt(0, variants.length - 1)];
      }
      break;
    }

    case "defaultOnly": {
      selectedVariant = variants.find((v) => v.id === "VAR_DEFAULT") || null;
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

function applyVariantStartEffects(storyPack: StoryPack, save: GameSave, rng: IRNG): GameSave {
  const variantId = save.state.runVariant?.id;
  if (!variantId) {
    return save;
  }

  const variants = storyPack.systems.runVariants || [];
  const variant = variants.find((v) => v.id === variantId);
  if (!variant || !variant.startEffects) {
    return save;
  }

  return applyEffects(variant.startEffects, storyPack, save, rng);
}

function applyFireWorldEvents(storyPack: StoryPack, save: GameSave, rng: IRNG): GameSave {
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
 * Gets a flat value from an object using a flat key (no nested path resolution)
 */
function getFlatValue(obj: Record<string, any>, key: string): any {
  return obj[key];
}

/**
 * Sets a flat value in an object using a flat key (no nested path resolution)
 */
function setFlatValue(obj: Record<string, any>, key: string, value: any): void {
  obj[key] = value;
}
