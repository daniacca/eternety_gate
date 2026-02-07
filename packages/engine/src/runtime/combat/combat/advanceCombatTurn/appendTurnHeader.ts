import type { ActorId, GameSave } from "../../types";
import { appendCombatLog } from "../../narration";

export function appendTurnHeader(save: GameSave, currentTurnActorId: ActorId, newTurnCounter: number): GameSave {
  const actor = save.actorsById[currentTurnActorId];
  const isPlayerTurn = actor?.kind === "PC";
  const actorName = actor?.name || currentTurnActorId;
  const turnHeader = isPlayerTurn ? `— Tocca a te —` : `— Turno ${newTurnCounter}: ${actorName} —`;

  const lastLogEntry = save.runtime.combatLog?.[save.runtime.combatLog.length - 1];
  if (lastLogEntry !== turnHeader) {
    return appendCombatLog(save, turnHeader);
  }

  return save;
}
