import type { Effect, GameSave } from "../../types";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";

/**
 * Get Prone: consumes all movement, adds prone condition
 */
export function combatGetProne(
  effect: Extract<Effect, { op: "combatGetProne" }>,
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

  // Consume all movement and add prone condition
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
      op: "addCondition",
      actorId: effect.actorId,
      condition: "prone",
      source: "getProne",
    },
  ];

  const actor = save.actorsById[effect.actorId];
  const logEntry = actor?.kind === "PC" ? `Ti metti a terra.` : `${actor?.name || effect.actorId} si mette a terra.`;
  currentSave = appendCombatLog(currentSave, logEntry);

  return { save: currentSave, emittedEffects };
}

