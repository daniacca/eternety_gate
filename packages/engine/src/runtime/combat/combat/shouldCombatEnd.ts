import type { ActorId, GameSave } from "../../types";
import { isActorAlive } from "../../characters/actors";

/**
 * Checks if combat should end based on faction deaths
 * Combat ends when:
 * - All enemies (NPCs) are dead, OR
 * - All party members (PCs) are dead
 */
export function shouldCombatEnd(
  save: GameSave,
  participants: ActorId[],
): { shouldEnd: boolean; outcome?: "victory" | "defeat"; winnerId?: ActorId } {
  const partyIds = new Set(save.party?.actors ?? []);
  const enemyIds = participants.filter((id) => !partyIds.has(id));

  const partyAlive = participants.filter((id) => {
    const actor = save.actorsById[id];
    return partyIds.has(id) && isActorAlive(actor);
  });

  const enemiesAlive = participants.filter((id) => {
    const actor = save.actorsById[id];
    return enemyIds.includes(id) && isActorAlive(actor);
  });

  if (enemiesAlive.length === 0 && partyAlive.length > 0) {
    // All enemies dead - party victory
    return { shouldEnd: true, outcome: "victory", winnerId: partyAlive[0] };
  }

  if (partyAlive.length === 0 && enemiesAlive.length > 0) {
    // All party dead - defeat
    return { shouldEnd: true, outcome: "defeat", winnerId: enemiesAlive[0] };
  }

  if (partyAlive.length === 0 && enemiesAlive.length === 0) {
    // Everyone dead - mutual defeat
    return { shouldEnd: true, outcome: "defeat" };
  }

  return { shouldEnd: false };
}
