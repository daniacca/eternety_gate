import { removeConditionFromActor } from "../../../../conditions";
import { appendCombatLog } from "../../../narration";

import type { SpecialOpParams, SpecialOpResult } from "../types";

export function resolveCombatPurgeConditions(params: SpecialOpParams): SpecialOpResult | null {
  const { save, effectDef, validTargetActors } = params;
  if (effectDef.specialOp !== "combatPurgeConditions" || validTargetActors.length === 0) {
    return null;
  }

  let updatedSave = save;
  const badConditions = new Set([
    "stunned",
    "bleeding",
    "fatigue",
    "unconscious",
    "bound",
    "halvedMovement",
    "prone",
    "misfortune",
    "shock",
    "force_field_overload",
  ]);
  for (const target of validTargetActors) {
    let updatedActor = target.actor;
    if (updatedActor.conditions) {
      for (const conditionId of Object.keys(updatedActor.conditions)) {
        if (badConditions.has(conditionId)) {
          updatedActor = removeConditionFromActor(updatedActor, conditionId as any);
        }
      }
    }
    if (updatedActor.status?.tempModifiers?.length) {
      const filteredMods = updatedActor.status.tempModifiers.filter((mod) => mod.value >= 0);
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
    if (updatedActor !== target.actor) {
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [target.actorId]: updatedActor,
        },
      };
      const targetName = target.actor.name || target.actorId;
      updatedSave = appendCombatLog(updatedSave, `${targetName} viene purificato dalle condizioni negative.`);
    }
  }

  return { handled: true, save: updatedSave };
}
