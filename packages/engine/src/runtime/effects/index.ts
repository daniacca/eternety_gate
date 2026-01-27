import type { Effect, GameSave, StoryPack } from "../types";
import { IRNG } from "../rng";
import type { ContentPack } from "../../content/types";
import { finalizeCombatIfEnded } from "../combat/combat";
import { getCombatEndEffects } from "../combat/combatEndHooks";
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
  combatFrenzy,
  combatWhirlwindAttack,
  combatGetProne,
  combatStandUp,
  combatPickup,
  combatDrop,
  combatEquipItem,
  combatUnequipItem,
  combatChannel,
  combatCastSpell,
} from "../combat/actions";
import { handleLearnSpell } from "./learnSpell";
import { handleNarrativeSpell } from "./narrativeSpell";
import { handleAcquireTalent, handleGrantXp, handleGrantFatePoint } from "./acquireTalent";
import { handleSetFateProtection } from "./fate";
import { applySetFlag, applyAddCounter } from "./state";
import { applyAddItem, applyAddInventoryItem, applyRemoveItem } from "./items";
import { handleGrantGold, handleSpendGold } from "./gold";
import { applyClearChoiceCheckResults } from "./choiceChecks";
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
  rng: IRNG,
  contentPack?: ContentPack
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
  addItem: (effect, storyPack, save, _rng) => ({
    save: applyAddItem(effect as Extract<Effect, { op: "addItem" }>, save, storyPack),
  }),
  addInventoryItem: (effect, storyPack, save, _rng) => ({
    save: applyAddInventoryItem(effect as Extract<Effect, { op: "addInventoryItem" }>, save, storyPack),
  }),
  removeItem: (effect, _storyPack, save, _rng) => ({
    save: applyRemoveItem(effect as Extract<Effect, { op: "removeItem" }>, save),
  }),
  clearChoiceCheckResults: (effect, _storyPack, save, _rng) => ({
    save: applyClearChoiceCheckResults(effect as Extract<Effect, { op: "clearChoiceCheckResults" }>, save),
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
  combatMove: (effect, _storyPack, save, _rng, contentPack) =>
    combatMove(effect as Extract<Effect, { op: "combatMove" }>, save, contentPack),
  combatEndTurn: (effect, storyPack, save, rng, contentPack) =>
    combatEndTurn(effect as Extract<Effect, { op: "combatEndTurn" }>, storyPack, save, rng, contentPack),
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
  combatFrenzy: (effect, storyPack, save, rng) =>
    combatFrenzy(effect as Extract<Effect, { op: "combatFrenzy" }>, storyPack, save, rng),
  combatWhirlwindAttack: (effect, storyPack, save, rng) =>
    combatWhirlwindAttack(effect as Extract<Effect, { op: "combatWhirlwindAttack" }>, storyPack, save, rng),
  combatGetProne: (effect, _storyPack, save, _rng) =>
    combatGetProne(effect as Extract<Effect, { op: "combatGetProne" }>, save),
  combatStandUp: (effect, storyPack, save, _rng) =>
    combatStandUp(effect as Extract<Effect, { op: "combatStandUp" }>, save, storyPack),
  combatPickup: (effect, storyPack, save, _rng) =>
    combatPickup(effect as Extract<Effect, { op: "combatPickup" }>, save, storyPack),
  combatDrop: (effect, _storyPack, save, _rng) => combatDrop(effect as Extract<Effect, { op: "combatDrop" }>, save),
  combatEquipItem: (effect, _storyPack, save, _rng) =>
    combatEquipItem(effect as Extract<Effect, { op: "combatEquipItem" }>, save),
  combatUnequipItem: (effect, _storyPack, save, _rng) =>
    combatUnequipItem(effect as Extract<Effect, { op: "combatUnequipItem" }>, save),
  combatChannel: (effect, storyPack, save, rng) =>
    combatChannel(effect as Extract<Effect, { op: "combatChannel" }>, storyPack, save, rng),
  combatCastSpell: (effect, storyPack, save, rng) =>
    combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, save, rng),
  learnSpell: (effect, storyPack, save, _rng) =>
    handleLearnSpell(effect as Extract<Effect, { op: "learnSpell" }>, storyPack, save),
  addCondition: (effect, storyPack, save, rng) => ({
    save: applyAddCondition(effect as Extract<Effect, { op: "addCondition" }>, save, storyPack, rng),
  }),
  removeCondition: (effect, _storyPack, save, _rng) => ({
    save: applyRemoveCondition(effect as Extract<Effect, { op: "removeCondition" }>, save),
  }),
  narrativeSpell: (effect, storyPack, save, rng) =>
    handleNarrativeSpell(effect as Extract<Effect, { op: "narrativeSpell" }>, storyPack, save, rng),
  acquireTalent: (effect, storyPack, save, _rng) =>
    handleAcquireTalent(effect as Extract<Effect, { op: "acquireTalent" }>, storyPack, save),
  grantXp: (effect, _storyPack, save, _rng) => handleGrantXp(effect as Extract<Effect, { op: "grantXp" }>, save),
  grantGold: (effect, _storyPack, save, _rng) => handleGrantGold(effect as Extract<Effect, { op: "grantGold" }>, save),
  spendGold: (effect, _storyPack, save, _rng) => handleSpendGold(effect as Extract<Effect, { op: "spendGold" }>, save),
  grantFatePoint: (effect, _storyPack, save, _rng) =>
    handleGrantFatePoint(effect as Extract<Effect, { op: "grantFatePoint" }>, save),
  setFateProtection: (effect, _storyPack, save, _rng) =>
    handleSetFateProtection(effect as Extract<Effect, { op: "setFateProtection" }>, save),
};

/**
 * Applies an effect to the game save (immutably)
 * Returns the updated save and optionally emitted effects
 */
export function applyEffect(
  effect: Effect,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG,
  contentPack?: ContentPack
): { save: GameSave; emittedEffects?: Effect[] } {
  const handler = effectHandlers[effect.op];
  if (handler) {
    return handler(effect, storyPack, save, rng, contentPack);
  }
  return { save };
}

function applyEffectsQueue(
  effects: Effect[],
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG,
  contentPack?: ContentPack
): GameSave {
  const queue: Effect[] = [...effects];
  let currentSave = save;

  while (queue.length > 0) {
    const effect = queue.shift()!;
    const result = applyEffect(effect, storyPack, currentSave, rng, contentPack);
    currentSave = result.save;

    if (result.emittedEffects && result.emittedEffects.length > 0) {
      queue.push(...result.emittedEffects);
    }
  }

  return currentSave;
}

/**
 * Applies multiple effects in sequence using a deterministic queue
 * Effects can emit other effects which are processed in order
 */
export function applyEffects(
  effects: Effect[],
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG,
  contentPack?: ContentPack
): GameSave {
  const hadCombatActive = Boolean(save.runtime.combat?.active);
  const currentSave = applyEffectsQueue(effects, storyPack, save, rng, contentPack);

  // Ensure combat end state is applied consistently regardless of which effect caused deaths.
  const finalizedSave = finalizeCombatIfEnded(currentSave);
  const combatEnded = hadCombatActive && !finalizedSave.runtime.combat?.active;

  if (!combatEnded) {
    return finalizedSave;
  }

  const combatEndEffects = getCombatEndEffects(storyPack, finalizedSave);
  if (combatEndEffects.length === 0) {
    return finalizedSave;
  }

  return applyEffectsQueue(combatEndEffects, storyPack, finalizedSave, rng, contentPack);
}
