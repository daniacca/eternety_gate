import type { ActorRef, GameSave, Actor, StoryPack } from "../types";
import { getStatOrSkillValue } from "./values";

/**
 * Resolves an ActorRef to an Actor
 */
export function resolveActor(
  actorRef: ActorRef | undefined,
  save: GameSave,
  storyPack?: StoryPack
): Actor | null {
  if (!actorRef) {
    return save.actorsById[save.party.activeActorId] || null;
  }

  switch (actorRef.mode) {
    case "active":
      return save.actorsById[save.party.activeActorId] || null;

    case "byId":
      return save.actorsById[actorRef.actorId] || null;

    case "bestOfParty": {
      let best: Actor | null = null;
      let bestValue = -Infinity;

      for (const actorId of save.party?.actors ?? []) {
        const actor = save.actorsById[actorId];
        if (!actor) continue;

        const value = getStatOrSkillValue(actor, actorRef.key, save, storyPack);
        if (value > bestValue) {
          bestValue = value;
          best = actor;
        }
      }

      return best;
    }

    case "askPlayer":
      // For now, default to active actor
      // In a real implementation, this would prompt the player
      return save.actorsById[save.party.activeActorId] || null;

    default:
      return null;
  }
}

