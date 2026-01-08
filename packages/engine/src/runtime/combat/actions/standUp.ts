import type { Effect, GameSave } from "../../types";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";

/**
 * Stand Up: consumes all movement, removes prone condition
 */
export function combatStandUp(
  effect: Extract<Effect, { op: "combatStandUp" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.actorId) {
    return { save };
  }

  if (combat.turn.moveRemaining <= 0) {
    return { save };
  }

  // Consume all movement and remove prone condition
  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      moveRemaining: 0,
    },
  };

  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
    },
  };

  const emittedEffects: Effect[] = [
    {
      op: "removeCondition",
      actorId: effect.actorId,
      condition: "prone",
    },
  ];

  const actor = save.actorsById[effect.actorId];
  const logEntry = actor?.kind === "PC" ? `Ti alzi in piedi.` : `${actor?.name || effect.actorId} si alza in piedi.`;
  currentSave = appendCombatLog(currentSave, logEntry);

  return { save: currentSave, emittedEffects };
}

