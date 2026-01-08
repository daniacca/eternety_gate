import type { Effect, GameSave, StoryPack } from "../types";
import { IRNG } from "../rng";
import {
  combatStart,
  combatMove,
  combatEndTurn,
  combatDefend,
  combatAim,
  combatAllOut,
  combatRequestAttack,
  combatKnockdown,
  combatDisarm,
  combatSwiftAttack,
  combatGetProne,
  combatStandUp,
  combatPickup,
  combatDrop,
  combatEquipItem,
  combatUnequipItem,
} from "../combat/actions";
import { applySetFlag, applyAddCounter } from "./state";
import { applyAddItem, applyRemoveItem } from "./items";
import { applyGoto } from "./navigation";
import { applyConditionalEffects } from "./conditional";
import { applyChooseRunVariant, applyVariantStartEffects } from "./variants";
import { applyFireWorldEvents } from "./worldEvents";
import { applyAddCondition, applyRemoveCondition } from "./actorConditions";

/**
 * Effect handler function type
 * Returns the updated save and optionally emitted effects to be processed next
 */
type EffectHandler = (
  effect: Effect,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
) => { save: GameSave; emittedEffects?: Effect[] };

/**
 * Registry of effect handlers by operation type
 */
const effectHandlers: Record<Effect["op"], EffectHandler> = {
  setFlag: (effect, _storyPack, save, _rng) => ({
    save: applySetFlag(effect as Extract<Effect, { op: "setFlag" }>, save),
  }),
  addCounter: (effect, _storyPack, save, _rng) => ({
    save: applyAddCounter(effect as Extract<Effect, { op: "addCounter" }>, save),
  }),
  addItem: (effect, _storyPack, save, _rng) => ({
    save: applyAddItem(effect as Extract<Effect, { op: "addItem" }>, save),
  }),
  removeItem: (effect, _storyPack, save, _rng) => ({
    save: applyRemoveItem(effect as Extract<Effect, { op: "removeItem" }>, save),
  }),
  goto: (effect, _storyPack, save, _rng) => ({
    save: applyGoto(effect as Extract<Effect, { op: "goto" }>, save),
  }),
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
  combatAllOut: (effect, _storyPack, save, _rng) =>
    combatAllOut(effect as Extract<Effect, { op: "combatAllOut" }>, save),
  combatRequestAttack: (effect, storyPack, save, rng) =>
    combatRequestAttack(effect as Extract<Effect, { op: "combatRequestAttack" }>, storyPack, save, rng),
  combatKnockdown: (effect, storyPack, save, rng) =>
    combatKnockdown(effect as Extract<Effect, { op: "combatKnockdown" }>, storyPack, save, rng),
  combatDisarm: (effect, storyPack, save, rng) =>
    combatDisarm(effect as Extract<Effect, { op: "combatDisarm" }>, storyPack, save, rng),
  combatSwiftAttack: (effect, storyPack, save, rng) =>
    combatSwiftAttack(effect as Extract<Effect, { op: "combatSwiftAttack" }>, storyPack, save, rng),
  combatGetProne: (effect, _storyPack, save, _rng) =>
    combatGetProne(effect as Extract<Effect, { op: "combatGetProne" }>, save),
  combatStandUp: (effect, _storyPack, save, _rng) =>
    combatStandUp(effect as Extract<Effect, { op: "combatStandUp" }>, save),
  combatPickup: (effect, _storyPack, save, _rng) =>
    combatPickup(effect as Extract<Effect, { op: "combatPickup" }>, save),
  combatDrop: (effect, _storyPack, save, _rng) => combatDrop(effect as Extract<Effect, { op: "combatDrop" }>, save),
  combatEquipItem: (effect, _storyPack, save, _rng) =>
    combatEquipItem(effect as Extract<Effect, { op: "combatEquipItem" }>, save),
  combatUnequipItem: (effect, _storyPack, save, _rng) =>
    combatUnequipItem(effect as Extract<Effect, { op: "combatUnequipItem" }>, save),
  addCondition: (effect, _storyPack, save, _rng) => ({
    save: applyAddCondition(effect as Extract<Effect, { op: "addCondition" }>, save),
  }),
  removeCondition: (effect, _storyPack, save, _rng) => ({
    save: applyRemoveCondition(effect as Extract<Effect, { op: "removeCondition" }>, save),
  }),
};

/**
 * Applies an effect to the game save (immutably)
 * Returns the updated save and optionally emitted effects
 */
export function applyEffect(
  effect: Effect,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const handler = effectHandlers[effect.op];
  if (handler) {
    return handler(effect, storyPack, save, rng);
  }
  return { save };
}

/**
 * Applies multiple effects in sequence using a deterministic queue
 * Effects can emit other effects which are processed in order
 */
export function applyEffects(effects: Effect[], storyPack: StoryPack, save: GameSave, rng: IRNG): GameSave {
  // Queue of effects to process
  const queue: Effect[] = [...effects];
  let currentSave = save;

  // Process queue deterministically
  while (queue.length > 0) {
    const effect = queue.shift()!;
    const result = applyEffect(effect, storyPack, currentSave, rng);
    currentSave = result.save;

    // Add emitted effects to queue (processed in order)
    if (result.emittedEffects && result.emittedEffects.length > 0) {
      queue.push(...result.emittedEffects);
    }
  }

  return currentSave;
}
