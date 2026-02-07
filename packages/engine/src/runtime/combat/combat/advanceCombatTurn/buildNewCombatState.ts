import type { ActorId, CombatState } from "../../types";

export function buildNewCombatState(
  combat: CombatState,
  finalAliveParticipants: ActorId[],
  newCurrentIndex: number,
  newRound: number,
  newTurnState: CombatState["turn"],
  newTurnCounter: number,
  updatedStancesByActorId: NonNullable<CombatState["stancesByActorId"]>,
  currentTurnActorId: ActorId,
): CombatState {
  const updatedFreeSpellUsed = {
    ...(combat.freeSpellUsedThisTurn || {}),
  };
  delete updatedFreeSpellUsed[currentTurnActorId];

  return {
    ...combat,
    participants: finalAliveParticipants,
    currentIndex: newCurrentIndex,
    round: newRound,
    turn: newTurnState,
    stancesByActorId: updatedStancesByActorId,
    turnCounter: newTurnCounter,
    parryDisabledUntilTurnCounterByActorId: combat.parryDisabledUntilTurnCounterByActorId || {},
    weaponRechargeUntilTurnCounterByActorId: combat.weaponRechargeUntilTurnCounterByActorId || {},
    freeSpellUsedThisTurn: updatedFreeSpellUsed,
  };
}
