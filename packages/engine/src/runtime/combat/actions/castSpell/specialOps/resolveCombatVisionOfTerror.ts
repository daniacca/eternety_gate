import type { SingleCheck } from "../../../../types";
import { addConditionToActor } from "../../../../conditions";
import { appendCombatLog } from "../../../narration";
import { performCheckWithSave } from "../../../../checks";
import { hasTalentHook } from "../../../../characters/talentModifiers";

import type { SpecialOpParams, SpecialOpResult } from "../types";

export function resolveCombatVisionOfTerror(params: SpecialOpParams): SpecialOpResult | null {
  const { save, storyPack, rng, catalogs, spell, effectDef, effectStatBonus, validTargetActors, getOvercastForTarget } =
    params;
  if (effectDef.specialOp !== "combatVisionOfTerror" || validTargetActors.length === 0) {
    return null;
  }

  let updatedSave = save;
  for (const target of validTargetActors) {
    if (target.actor.traits?.["trait:from_beyond"] !== undefined) {
      continue;
    }
    if (catalogs && hasTalentHook(target.actor, catalogs, "jaded")) {
      continue;
    }
    if (target.actor.conditions?.frenzy !== undefined) {
      continue;
    }
    const targetOvercast = getOvercastForTarget(target.actorId);
    const fearPenalty = -(5 * effectStatBonus + 5 * targetOvercast);
    const fearCheck: SingleCheck = {
      id: `combat:visionTerror:${spell.id}:${target.actorId}`,
      kind: "single",
      actorRef: { mode: "byId", actorId: target.actorId },
      key: "WIL",
      difficulty: "Challenging",
      modifier: fearPenalty,
    };
    const { result: fearResult, save: saveAfterFearCheck } = performCheckWithSave(
      fearCheck,
      storyPack,
      updatedSave,
      rng,
      `res:visionTerror:${spell.id}:${target.actorId}`
    );
    updatedSave = saveAfterFearCheck;
    if (!fearResult?.success) {
      const shockedActor = addConditionToActor(
        updatedSave.actorsById[target.actorId],
        "shock",
        1,
        undefined,
        `spell:${spell.id}`
      );
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [target.actorId]: shockedActor,
        },
      };
      const fearLog =
        target.actor.kind === "PC"
          ? "Sei sopraffatto dal terrore e resti sotto shock."
          : `${target.actor.name || target.actorId} è sopraffatto dal terrore e resta sotto shock.`;
      updatedSave = appendCombatLog(updatedSave, fearLog);
    }
  }

  return { handled: true, save: updatedSave };
}
