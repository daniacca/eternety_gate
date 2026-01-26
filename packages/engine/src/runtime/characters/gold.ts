import type { ActorId, GameSave } from "../types";

export function getActorGold(save: GameSave, actorId: ActorId): number {
  const actor = save.actorsById[actorId];
  return actor?.resources.gold ?? 0;
}

export function grantActorGold(save: GameSave, actorId: ActorId, amount: number): GameSave {
  const actor = save.actorsById[actorId];
  if (!actor) {
    console.warn(`[grantActorGold] Actor not found: ${actorId}`);
    return save;
  }
  const currentGold = actor.resources.gold ?? 0;
  const nextGold = currentGold + amount;
  const updatedActor = {
    ...actor,
    resources: {
      ...actor.resources,
      gold: nextGold,
    },
  };
  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [actorId]: updatedActor,
    },
  };
}

export function spendActorGold(save: GameSave, actorId: ActorId, amount: number): { save: GameSave; error?: string } {
  const actor = save.actorsById[actorId];
  if (!actor) {
    return { save, error: `Actor ${actorId} not found` };
  }
  const currentGold = actor.resources.gold ?? 0;
  if (currentGold < amount) {
    return { save, error: `Not enough gold (need ${amount}, have ${currentGold})` };
  }
  const updatedActor = {
    ...actor,
    resources: {
      ...actor.resources,
      gold: currentGold - amount,
    },
  };
  return {
    save: {
      ...save,
      actorsById: {
        ...save.actorsById,
        [actorId]: updatedActor,
      },
    },
  };
}
