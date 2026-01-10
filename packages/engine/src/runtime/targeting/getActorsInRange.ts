import type { GameSave, ActorId } from "../types";
import { distanceChebyshev } from "../combat/movement";

/**
 * Gets all actors within a given range from a caster
 * Used for phenomena random target selection
 */
export function getActorsInRange(
  save: GameSave,
  casterId: ActorId,
  rangeSquares: number,
  options?: {
    includeCaster?: boolean;
    allowFriendlyFire?: boolean;
    excludeActorId?: ActorId; // Optional: exclude a specific actor (e.g., original target)
  }
): ActorId[] {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return [];
  }

  const casterPos = combat.positions[casterId];
  if (!casterPos) {
    return [];
  }

  const includeCaster = options?.includeCaster ?? false;
  const excludeActorId = options?.excludeActorId;

  const candidates: ActorId[] = [];

  for (const actorId of combat.participants) {
    // Skip caster if not included
    if (!includeCaster && actorId === casterId) {
      continue;
    }

    // Skip excluded actor
    if (excludeActorId && actorId === excludeActorId) {
      continue;
    }

    // Check if actor is alive
    const actor = save.actorsById[actorId];
    if (!actor || actor.resources.isDead === true) {
      continue;
    }

    // Check range
    const actorPos = combat.positions[actorId];
    if (!actorPos) {
      continue;
    }

    const distance = distanceChebyshev(casterPos, actorPos);
    if (distance <= rangeSquares) {
      candidates.push(actorId);
    }
  }

  // Sort by distance, then by actorId for determinism
  candidates.sort((a, b) => {
    const posA = combat.positions[a];
    const posB = combat.positions[b];
    if (!posA || !posB) return 0;
    const distA = distanceChebyshev(casterPos, posA);
    const distB = distanceChebyshev(casterPos, posB);
    if (distA !== distB) return distA - distB;
    return a.localeCompare(b);
  });

  return candidates;
}
