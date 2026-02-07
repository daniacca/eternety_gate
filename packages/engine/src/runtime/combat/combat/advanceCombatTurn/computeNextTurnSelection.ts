import type { ActorId, CombatState } from "../../types";

export function computeNextTurnSelection(
  combat: CombatState,
  aliveParticipants: ActorId[],
): {
  prevActorId: ActorId;
  newCurrentIndex: number;
  newRound: number;
  currentTurnActorId: ActorId;
} {
  const prevActorId = combat.participants[combat.currentIndex];
  const prevAliveIndex = aliveParticipants.indexOf(prevActorId);
  const pivotIndex = prevAliveIndex >= 0 ? prevAliveIndex : Math.min(combat.currentIndex, aliveParticipants.length - 1);

  const newCurrentIndex = (pivotIndex + 1) % aliveParticipants.length;
  const newRound = newCurrentIndex === 0 ? combat.round + 1 : combat.round;
  const currentTurnActorId = aliveParticipants[newCurrentIndex];

  return {
    prevActorId,
    newCurrentIndex,
    newRound,
    currentTurnActorId,
  };
}
