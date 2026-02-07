import type { ActorId, ConditionId, GameSave } from "../../../types";
import { removeConditionFromActor } from "../../../conditions";
import { removeUnnaturalCharacteristicsBySource, removeTraitsBySource } from "../../../characters/traitHelpers";
import { cleanupConditionRemoval } from "..";
import { appendCombatLog } from "../../narration";

export function removeExpiredConditions(params: {
  updatedSave: GameSave;
  currentActor: GameSave["actorsById"][string];
  currentTurnActorId: ActorId;
  newTurnCounter: number;
}): { updatedSave: GameSave; currentActor: GameSave["actorsById"][string] } {
  let { updatedSave, currentActor } = params;
  const { currentTurnActorId, newTurnCounter } = params;

  const conditionsToRemove: Array<{ conditionId: string; source?: string }> = [];

  if (currentActor.conditions) {
    for (const [conditionId, instance] of Object.entries(currentActor.conditions)) {
      if (instance.untilTurnCounter !== undefined && instance.untilTurnCounter < newTurnCounter) {
        conditionsToRemove.push({
          conditionId,
          source: instance.source,
        });
      }
    }

    for (const { conditionId, source } of conditionsToRemove) {
      const conditionKey = conditionId as ConditionId;
      const instance = currentActor.conditions?.[conditionKey];
      if (instance) {
        currentActor = cleanupConditionRemoval(currentActor, conditionId, instance);
        if (conditionId === "mind_control" && instance.params?.addedToParty) {
          const updatedPartyActors = (updatedSave.party?.actors ?? []).filter((id) => id !== currentTurnActorId);
          const nextActiveActorId =
            updatedSave.party?.activeActorId === currentTurnActorId
              ? updatedPartyActors[0] ?? updatedSave.party?.activeActorId
              : updatedSave.party?.activeActorId;
          updatedSave = {
            ...updatedSave,
            party: {
              ...updatedSave.party,
              actors: updatedPartyActors,
              activeActorId: nextActiveActorId,
            },
          };
        }
        if (conditionId === "summoned") {
          const updatedPartyActors = (updatedSave.party?.actors ?? []).filter((id) => id !== currentTurnActorId);
          updatedSave = {
            ...updatedSave,
            party: {
              ...updatedSave.party,
              actors: updatedPartyActors,
              activeActorId: updatedSave.party?.activeActorId ?? currentTurnActorId,
            },
            runtime: {
              ...updatedSave.runtime,
              combat: {
                ...updatedSave.runtime.combat!,
                positions: Object.fromEntries(
                  Object.entries(updatedSave.runtime.combat!.positions).filter(([id]) => id !== currentTurnActorId),
                ),
              },
            },
          };
          currentActor = {
            ...currentActor,
            resources: {
              ...currentActor.resources,
              isDead: true,
            },
          };
          updatedSave = appendCombatLog(updatedSave, `${currentActor.name || currentTurnActorId} torna nel nulla.`);
        }
      } else if (source) {
        currentActor = removeUnnaturalCharacteristicsBySource(currentActor, source);
        currentActor = removeTraitsBySource(currentActor, source);
      }
      currentActor = removeConditionFromActor(currentActor, conditionKey as any);
    }

    if (conditionsToRemove.length > 0) {
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [currentTurnActorId]: currentActor,
        },
      };
    }
  }

  return { updatedSave, currentActor };
}
