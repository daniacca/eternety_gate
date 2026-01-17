import type { ActorId, GameSave } from "../types";

function ensureMap<T extends Record<string, number> | undefined>(map: T): Record<string, number> {
  return map ? { ...map } : {};
}

export function trackCombatDamage(
  save: GameSave,
  attackerId: ActorId,
  defenderId: ActorId,
  amount: number
): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active || amount <= 0) return save;

  const damageTaken = ensureMap(combat.damageTakenSinceLastTurnByActorId);
  const damageDealt = ensureMap(combat.damageDealtSinceLastTurnByActorId);

  damageTaken[defenderId] = (damageTaken[defenderId] ?? 0) + amount;
  damageDealt[attackerId] = (damageDealt[attackerId] ?? 0) + amount;

  return {
    ...save,
    runtime: {
      ...save.runtime,
      combat: {
        ...combat,
        damageTakenSinceLastTurnByActorId: damageTaken,
        damageDealtSinceLastTurnByActorId: damageDealt,
      },
    },
  };
}

export function trackCombatSelfDamage(save: GameSave, actorId: ActorId, amount: number): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active || amount <= 0) return save;

  const damageTaken = ensureMap(combat.damageTakenSinceLastTurnByActorId);
  damageTaken[actorId] = (damageTaken[actorId] ?? 0) + amount;

  return {
    ...save,
    runtime: {
      ...save.runtime,
      combat: {
        ...combat,
        damageTakenSinceLastTurnByActorId: damageTaken,
      },
    },
  };
}

export function getCombatDamageTracking(
  save: GameSave,
  actorId: ActorId
): { taken: number; dealt: number } {
  const combat = save.runtime.combat;
  if (!combat?.active) return { taken: 0, dealt: 0 };

  return {
    taken: combat.damageTakenSinceLastTurnByActorId?.[actorId] ?? 0,
    dealt: combat.damageDealtSinceLastTurnByActorId?.[actorId] ?? 0,
  };
}

export function resetCombatDamageTrackingForActor(save: GameSave, actorId: ActorId): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) return save;

  const damageTaken = ensureMap(combat.damageTakenSinceLastTurnByActorId);
  const damageDealt = ensureMap(combat.damageDealtSinceLastTurnByActorId);

  damageTaken[actorId] = 0;
  damageDealt[actorId] = 0;

  return {
    ...save,
    runtime: {
      ...save.runtime,
      combat: {
        ...combat,
        damageTakenSinceLastTurnByActorId: damageTaken,
        damageDealtSinceLastTurnByActorId: damageDealt,
      },
    },
  };
}
