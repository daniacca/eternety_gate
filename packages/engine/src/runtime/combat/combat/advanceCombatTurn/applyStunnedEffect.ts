import type { ActorId, GameSave } from "../../../types";
import { hasCondition } from "../../../conditions";
import { appendCombatLog } from "../../narration";

export function applyStunnedEffect(
  updatedSave: GameSave,
  currentTurnActorId: ActorId,
  newTurnCounter: number,
  newTurnState: GameSave["runtime"]["combat"]["turn"],
): { updatedSave: GameSave; newTurnState: GameSave["runtime"]["combat"]["turn"] } {
  const currentActor = updatedSave.actorsById[currentTurnActorId];
  if (!currentActor) return { updatedSave, newTurnState };

  if (hasCondition(currentActor, "stunned")) {
    const stunnedCondition = currentActor.conditions?.stunned;
    if (stunnedCondition?.untilTurnCounter !== undefined && stunnedCondition.untilTurnCounter >= newTurnCounter) {
      const isPlayerActor = currentActor.kind === "PC";
      const actorName = currentActor.name || currentTurnActorId;
      const stunnedLog = isPlayerActor
        ? "Sei stordito e perdi il turno."
        : `${actorName} è stordito e perde il turno.`;

      updatedSave = appendCombatLog(updatedSave, stunnedLog);
      newTurnState = {
        moveRemaining: 0,
        actionAvailable: false,
      };
    }
  }

  return { updatedSave, newTurnState };
}
