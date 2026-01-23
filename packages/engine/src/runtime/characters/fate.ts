import type { Actor, ActorId, GameSave } from "../types";

export function hasFatePoints(actor: Actor | undefined): boolean {
  return (actor?.resources.fatePoints ?? 0) > 0;
}

export function isFateProtectionActive(actor: Actor | undefined): boolean {
  return Boolean(actor?.resources.fateProtectionActive) && hasFatePoints(actor);
}

export function setFateProtectionActiveForActor(actor: Actor, active: boolean): Actor {
  const canActivate = active && hasFatePoints(actor);
  if ((actor.resources.fateProtectionActive ?? false) === canActivate) {
    return actor;
  }
  return {
    ...actor,
    resources: {
      ...actor.resources,
      fateProtectionActive: canActivate,
    },
  };
}

export function setFateProtectionActive(save: GameSave, actorId: ActorId, active: boolean): GameSave {
  const actor = save.actorsById[actorId];
  if (!actor) return save;
  const updatedActor = setFateProtectionActiveForActor(actor, active);
  if (updatedActor === actor) return save;
  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [actorId]: updatedActor,
    },
  };
}

export function consumeFateProtection(save: GameSave, actorId: ActorId): { save: GameSave; consumed: boolean } {
  const actor = save.actorsById[actorId];
  if (!actor || !isFateProtectionActive(actor)) {
    return { save, consumed: false };
  }

  const currentFp = actor.resources.fatePoints ?? 0;
  const nextFp = Math.max(0, currentFp - 1);

  const updatedActor: Actor = {
    ...actor,
    resources: {
      ...actor.resources,
      fatePoints: nextFp,
      fateProtectionActive: false,
    },
  };

  return {
    consumed: true,
    save: {
      ...save,
      actorsById: {
        ...save.actorsById,
        [actorId]: updatedActor,
      },
    },
  };
}
