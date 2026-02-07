import type { ActorId, CombatState } from "../../types";

export function resetStancesForNewTurn(
  combat: CombatState,
  prevActorId: ActorId,
  currentTurnActorId: ActorId,
): NonNullable<CombatState["stancesByActorId"]> {
  const updatedStancesByActorId = { ...(combat.stancesByActorId || {}) };

  if (prevActorId === currentTurnActorId) {
    // Same actor's next turn started - remove all stances including aim
    delete updatedStancesByActorId[currentTurnActorId];
  } else {
    // Different actor's turn started - remove their non-aim stances, keep aim if present
    if (updatedStancesByActorId[currentTurnActorId] !== "aim") {
      delete updatedStancesByActorId[currentTurnActorId];
    }
  }

  return updatedStancesByActorId;
}
