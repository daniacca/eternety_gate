import type { ActorId, GameSave } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { footprintDistanceBetweenActors } from "./footprint";
import { isActorAlive } from "../characters/actors";
import { getUntouchableAuraRadius, getUntouchableWilBonus, isUntouchable } from "../characters/untouchable";

export type UntouchableAuraImpact = {
  sourceId: ActorId;
  radius: number;
  distance: number;
  wilBonus: number;
  penalty: number;
};

/**
 * Finds the strongest untouchable aura affecting the actor (most negative penalty).
 */
export function getUntouchableAuraImpact(
  save: GameSave,
  catalogs: CharacterCatalogs | undefined,
  actorId: ActorId
): UntouchableAuraImpact | null {
  const combat = save.runtime.combat;
  if (!combat?.active) return null;

  let best: UntouchableAuraImpact | null = null;

  for (const otherId of combat.participants) {
    if (otherId === actorId) continue;
    const otherActor = save.actorsById[otherId];
    if (!otherActor || !isActorAlive(otherActor) || !isUntouchable(otherActor)) continue;

    const radius = getUntouchableAuraRadius(save, catalogs, otherId);
    if (radius <= 0) continue;

    const distance = footprintDistanceBetweenActors(save, actorId, otherId);
    if (distance > radius) continue;

    const wilBonus = getUntouchableWilBonus(save, otherId, catalogs);
    const penalty = -(5 * wilBonus);

    if (!best || penalty < best.penalty) {
      best = {
        sourceId: otherId,
        radius,
        distance,
        wilBonus,
        penalty,
      };
    }
  }

  return best;
}
