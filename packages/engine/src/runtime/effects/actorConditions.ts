import type { Effect, GameSave } from "../types";
import { addConditionToActor, removeConditionFromActor } from "../conditions";

export function applyAddCondition(effect: Extract<Effect, { op: "addCondition" }>, save: GameSave): GameSave {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return save; // Actor not found, ignore
  }

  // Calculate untilTurnCounter if durationTurns is provided
  let untilTurnCounter: number | undefined = undefined;
  if (effect.durationTurns !== undefined && save.runtime.combat?.active) {
    const currentTurnCounter = save.runtime.combat.turnCounter ?? 0;
    untilTurnCounter = currentTurnCounter + effect.durationTurns;
  }

  const updatedActor = addConditionToActor(actor, effect.condition, effect.stacks, untilTurnCounter, effect.source);

  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
  };
}

export function applyRemoveCondition(effect: Extract<Effect, { op: "removeCondition" }>, save: GameSave): GameSave {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return save; // Actor not found, ignore
  }

  const updatedActor = removeConditionFromActor(actor, effect.condition);

  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
  };
}

