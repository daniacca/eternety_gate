import type { ActorId, CheckResult } from "../../types";

export function updateLastCheckForNewTurn(
  last: CheckResult | null,
  newRound: number,
  currentTurnActorId: ActorId,
): CheckResult | null {
  if (!last) return null;
  return {
    ...last,
    tags: [
      ...last.tags.filter((tag) => !tag.startsWith("combat:round=") && !tag.startsWith("combat:turn=")),
      `combat:round=${newRound}`,
      `combat:turn=${currentTurnActorId}`,
    ],
  };
}
