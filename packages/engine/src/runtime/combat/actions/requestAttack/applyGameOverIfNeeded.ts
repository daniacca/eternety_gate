import type { ActorId, GameSave } from "../../../types";
import { appendCombatLog } from "../../narration";

export function applyGameOverIfNeeded(currentSave: GameSave, targetId: ActorId): GameSave {
  const deadActor = currentSave.actorsById[targetId];
  if (!deadActor) return currentSave;
  const pcDied = deadActor.kind === "PC";
  const partyActors = currentSave.party.actors.map((id) => currentSave.actorsById[id]).filter(Boolean);
  const allPartyDead = partyActors.length > 0 && partyActors.every((actor) => actor.resources.isDead === true);
  if (pcDied || allPartyDead) {
    const reason = pcDied ? ("playerDead" as const) : ("partyDead" as const);
    const updated = {
      ...currentSave,
      runtime: {
        ...currentSave.runtime,
        gameOver: {
          reason,
          sceneId: currentSave.runtime.currentSceneId,
        },
        combat: undefined,
      },
    };
    return appendCombatLog(updated, "Game Over.");
  }
  return currentSave;
}
