import type { Effect, GameSave } from "../../../types";

export function consumeCombatAction(
  combat: NonNullable<GameSave["runtime"]["combat"]>,
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
): NonNullable<GameSave["runtime"]["combat"]> {
  return {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
    },
    stancesByActorId: combat.stancesByActorId, // Keep aim stance for check calculation
    channeling: combat.channeling?.actorId === effect.attackerId ? undefined : combat.channeling,
  };
}
