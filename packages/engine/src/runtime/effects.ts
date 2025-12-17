import type { Effect, GameSave, StoryPack, Condition, SceneId, ItemId, WorldEventId, ActorId, Position } from "./types";
import { evaluateCondition, evaluateConditions } from "./conditions";
import { RNG } from "./rng";
import { performCheck } from "./checks";
import { startCombat, getCurrentTurnActorId, advanceCombatTurn, runNpcTurn } from "./engine";

/**
 * Helper to append a combat log entry
 */
function appendCombatLog(save: GameSave, entry: string): GameSave {
  const currentLog = save.runtime.combatLog || [];
  const newLog = [...currentLog, entry];
  // Keep only last 50 entries to avoid memory issues
  const trimmedLog = newLog.slice(-50);
  return {
    ...save,
    runtime: {
      ...save.runtime,
      combatLog: trimmedLog,
    },
  };
}

/**
 * Applies an effect to the game save (immutably)
 */
export function applyEffect(effect: Effect, storyPack: StoryPack, save: GameSave, rng: RNG): GameSave {
  switch (effect.op) {
    case "setFlag":
      return applySetFlag(effect, save);

    case "addCounter":
      return applyAddCounter(effect, save);

    case "addItem":
      return applyAddItem(effect, save);

    case "removeItem":
      return applyRemoveItem(effect, save);

    case "goto":
      return applyGoto(effect, save);

    case "conditionalEffects":
      return applyConditionalEffects(effect, storyPack, save, rng);

    case "chooseRunVariant":
      return applyChooseRunVariant(effect, storyPack, save, rng);

    case "applyVariantStartEffects":
      return applyVariantStartEffects(storyPack, save, rng);

    case "fireWorldEvents":
      return applyFireWorldEvents(storyPack, save, rng);

    case "combatStart":
      return applyCombatStart(effect, storyPack, save);

    case "combatMove":
      return applyCombatMove(effect, save);

    case "combatEndTurn":
      return applyCombatEndTurn(effect, storyPack, save, rng);

    default:
      return save;
  }
}

/**
 * Applies multiple effects in sequence
 */
export function applyEffects(effects: Effect[], storyPack: StoryPack, save: GameSave, rng: RNG): GameSave {
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
  effect: Extract<Effect, { op: "chooseRunVariant" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
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

function applyVariantStartEffects(storyPack: StoryPack, save: GameSave, rng: RNG): GameSave {
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

function applyFireWorldEvents(storyPack: StoryPack, save: GameSave, rng: RNG): GameSave {
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

/**
 * Starts combat with given participant IDs, grid, and placements
 */
function applyCombatStart(
  effect: Extract<Effect, { op: "combatStart" }>,
  storyPack: StoryPack,
  save: GameSave
): GameSave {
  return startCombat(
    storyPack,
    save,
    effect.participantIds,
    save.runtime.currentSceneId,
    effect.grid,
    effect.placements
  );
}

/**
 * Moves actor in combat grid
 */
function applyCombatMove(effect: Extract<Effect, { op: "combatMove" }>, save: GameSave): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    // Not in combat - ignore
    const ignoredCheck = {
      checkId: "combat:move:ignored",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:move:ignored"],
    };
    return {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: ignoredCheck,
      },
    };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== save.party.activeActorId) {
    // Not player's turn
    const blockedCheck = {
      checkId: "combat:move:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: blockedCheck,
      },
    };
  }

  if (combat.turn.hasMoved) {
    // Already moved this turn
    const blockedCheck = {
      checkId: "combat:move:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=alreadyMoved"],
    };
    return {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: blockedCheck,
      },
    };
  }

  // Calculate delta based on direction
  const dirDeltas: Record<string, Position> = {
    N: { x: 0, y: -1 },
    NE: { x: 1, y: -1 },
    E: { x: 1, y: 0 },
    SE: { x: 1, y: 1 },
    S: { x: 0, y: 1 },
    SW: { x: -1, y: 1 },
    W: { x: -1, y: 0 },
    NW: { x: -1, y: -1 },
  };

  const delta = dirDeltas[effect.dir];
  if (!delta) {
    return save;
  }

  const currentPos = combat.positions[turnActorId] || { x: 0, y: 0 };
  const newPos = {
    x: Math.max(0, Math.min(combat.grid.width - 1, currentPos.x + delta.x)),
    y: Math.max(0, Math.min(combat.grid.height - 1, currentPos.y + delta.y)),
  };

  const updatedPositions = {
    ...combat.positions,
    [turnActorId]: newPos,
  };

  const updatedCombat = {
    ...combat,
    positions: updatedPositions,
    turn: {
      ...combat.turn,
      hasMoved: true,
    },
  };

  const moveCheck = {
    checkId: "combat:move",
    actorId: turnActorId,
    roll: 0,
    target: 0,
    success: true,
    dos: 0,
    dof: 0,
    critical: "none" as const,
    tags: [`combat:move=${effect.dir}`, `combat:pos:${turnActorId}=${newPos.x},${newPos.y}`],
  };

  const actor = save.actorsById[turnActorId];
  const dirLabels: Record<string, string> = {
    N: "nord",
    NE: "nord-est",
    E: "est",
    SE: "sud-est",
    S: "sud",
    SW: "sud-ovest",
    W: "ovest",
    NW: "nord-ovest",
  };
  const dirLabel = dirLabels[effect.dir] || effect.dir;
  const logEntry =
    actor?.kind === "PC" ? `Ti muovi verso ${dirLabel}.` : `${actor?.name || turnActorId} avanza verso di te.`;

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
      lastCheck: moveCheck,
    },
  };

  // Add narration to combat log
  updatedSave = appendCombatLog(updatedSave, logEntry);

  return updatedSave;
}

/**
 * Ends the current turn and advances to next actor, running NPC turns until player's turn
 */
function applyCombatEndTurn(
  effect: Extract<Effect, { op: "combatEndTurn" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return save;
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== save.party.activeActorId) {
    // Not player's turn - ignore
    return save;
  }

  // Advance turn (player ended their turn)
  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      rngCounter: rng.getCounter(),
    },
  };
  currentSave = advanceCombatTurn(currentSave);

  // Loop: run NPC turns until it's player's turn again
  let safety = 0;
  while (currentSave.runtime.combat?.active && getCurrentTurnActorId(currentSave) !== currentSave.party.activeActorId) {
    const npcId = getCurrentTurnActorId(currentSave);
    if (!npcId) break;

    const npcRng = new RNG(currentSave.runtime.rngSeed, currentSave.runtime.rngCounter || 0);
    currentSave = runNpcTurn(storyPack, currentSave, npcId);
    currentSave = advanceCombatTurn(currentSave);

    safety++;
    if (safety > 10) break; // safety guard
  }

  return currentSave;
}
