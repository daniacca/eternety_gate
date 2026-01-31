import type { SingleCheck } from "../../../../types";
import { addConditionToActor } from "../../../../conditions";
import { appendCombatLog } from "../../../narration";
import { performCheckWithSave } from "../../../../checks";

import type { SpecialOpParams, SpecialOpResult } from "../types";

export function resolveCombatSunburst(params: SpecialOpParams): SpecialOpResult | null {
  const { save, storyPack, rng, combat, turnActorId, spell, effectDef, overcast, effectStatBonus, validTargetActors } =
    params;
  if (effectDef.specialOp !== "combatSunburst") {
    return null;
  }

  let updatedSave = save;
  const caster = updatedSave.actorsById[turnActorId];
  if (caster) {
    const baseDuration = Math.max(1, effectStatBonus + overcast);
    const untilTurnCounter = combat.turnCounter + baseDuration;
    const updatedCaster = addConditionToActor(caster, "sunburst", 1, untilTurnCounter, `spell:${spell.id}`, {
      wilBonus: effectStatBonus,
    });
    updatedSave = {
      ...updatedSave,
      actorsById: {
        ...updatedSave.actorsById,
        [turnActorId]: updatedCaster,
      },
    };
  }

  for (const target of validTargetActors) {
    if (target.actorId === turnActorId) continue;
    const touPenalty = -(5 * effectStatBonus);
    const touCheck: SingleCheck = {
      id: `combat:sunburst:${spell.id}:${target.actorId}`,
      kind: "single",
      actorRef: { mode: "byId", actorId: target.actorId },
      key: "TOU",
      difficulty: "Challenging",
      modifier: touPenalty,
    };
    const { result: touResult, save: saveAfterTou } = performCheckWithSave(
      touCheck,
      storyPack,
      updatedSave,
      rng,
      `res:sunburst:${spell.id}:${target.actorId}`
    );
    updatedSave = saveAfterTou;
    if (!touResult?.success) {
      const blindDuration = 1 + Math.max(0, touResult?.dof ?? 0);
      const untilTurnCounter = combat.turnCounter + blindDuration;
      const blindedActor = addConditionToActor(
        updatedSave.actorsById[target.actorId],
        "blind",
        1,
        untilTurnCounter,
        `spell:${spell.id}`
      );
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [target.actorId]: blindedActor,
        },
      };
      const blindLog =
        target.actor.kind === "PC"
          ? "Sei accecato dal bagliore."
          : `${target.actor.name || target.actorId} viene accecato dal bagliore.`;
      updatedSave = appendCombatLog(updatedSave, blindLog);
    }
  }

  return { handled: true, save: updatedSave };
}
