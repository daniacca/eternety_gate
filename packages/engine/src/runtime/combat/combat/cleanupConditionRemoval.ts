import type { Actor } from "../../types";
import { removeUnnaturalCharacteristicsBySource, removeTraitsBySource } from "../../characters/traitHelpers";

export function cleanupConditionRemoval(
  actor: Actor,
  conditionId: string,
  instance: { source?: string; params?: Record<string, any> },
): Actor {
  let updatedActor = actor;
  if (instance.source) {
    updatedActor = removeUnnaturalCharacteristicsBySource(updatedActor, instance.source);
    updatedActor = removeTraitsBySource(updatedActor, instance.source);
  }

  if (conditionId === "giant_form") {
    const deltas = instance.params?.statDeltas;
    if (deltas && typeof deltas === "object") {
      updatedActor = {
        ...updatedActor,
        stats: {
          ...updatedActor.stats,
          STR: (updatedActor.stats.STR ?? 0) - (deltas.STR ?? 0),
          TOU: (updatedActor.stats.TOU ?? 0) - (deltas.TOU ?? 0),
          AGI: (updatedActor.stats.AGI ?? 0) - (deltas.AGI ?? 0),
        },
      };
    }
    const hadSizeTrait = instance.params?.hadSizeTrait;
    const previousSize = instance.params?.previousSize;
    if (typeof previousSize === "number") {
      const updatedTraits = { ...updatedActor.traits };
      if (hadSizeTrait) {
        updatedTraits["trait:size"] = { size: previousSize };
      } else {
        delete updatedTraits["trait:size"];
      }
      updatedActor = { ...updatedActor, traits: updatedTraits };
    }
  }

  if (conditionId === "weave_of_fate") {
    const originalFp = instance.params?.originalFatePoints ?? 0;
    const tempFate = instance.params?.tempFate ?? 0;
    const currentFp = updatedActor.resources.fatePoints ?? 0;
    const removeAmount = currentFp > originalFp ? Math.min(tempFate, currentFp - originalFp) : 0;
    if (removeAmount > 0) {
      const newFp = Math.max(0, currentFp - removeAmount);
      updatedActor = {
        ...updatedActor,
        resources: {
          ...updatedActor.resources,
          fatePoints: newFp,
          fateProtectionActive: newFp > 0 ? updatedActor.resources.fateProtectionActive : false,
        },
      };
    }
  }

  return updatedActor;
}
