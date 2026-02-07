import type { ActorId, GameSave } from "../../types";
import { removeConditionFromActor } from "../../conditions";
import { cleanupConditionRemoval } from "./cleanupConditionRemoval";

export function clearCombatEndConditions(
  save: GameSave,
  participants: ActorId[],
): { actorsById: GameSave["actorsById"]; partyActors: ActorId[] } {
  const clearedActorsById = { ...save.actorsById };
  let partyActors = [...(save.party?.actors ?? [])];
  for (const actorId of participants) {
    const actor = clearedActorsById[actorId];
    if (!actor) continue;
    let updatedActor = actor;

    if (actor.conditions) {
      for (const [conditionId, instance] of Object.entries(actor.conditions)) {
        if (conditionId !== "shock" && instance.untilTurnCounter === undefined) {
          continue;
        }
        updatedActor = cleanupConditionRemoval(updatedActor, conditionId, instance);
        updatedActor = removeConditionFromActor(updatedActor, conditionId as any);
        if (conditionId === "mind_control" && instance.params?.addedToParty) {
          partyActors = partyActors.filter((id) => id !== actorId);
        }
        if (conditionId === "summoned") {
          partyActors = partyActors.filter((id) => id !== actorId);
        }
      }
    }

    if (updatedActor.status?.tempModifiers?.length) {
      const filteredMods = updatedActor.status.tempModifiers.filter((mod) => mod.expires === undefined);
      if (filteredMods.length !== updatedActor.status.tempModifiers.length) {
        updatedActor = {
          ...updatedActor,
          status: {
            ...updatedActor.status,
            tempModifiers: filteredMods,
          },
        };
      }
    }

    if (updatedActor !== actor) {
      clearedActorsById[actorId] = updatedActor;
    }
  }
  return { actorsById: clearedActorsById, partyActors };
}
