import type { ActorId, SingleCheck } from "../../../../types";
import { performCheckWithSave } from "../../../../checks";
import { applyDamageToActor } from "../../../criticalDamage";
import { getBestResistStat } from "../../../../magic/denyTheWitch";
import { getResistBasePenalty, getResistCheckModifier } from "../../../../magic/resist";
import { getResistanceBonus } from "../../../../characters/talentModifiers";
import { getUntouchableDenyBonus } from "../../../../characters/untouchable";

import type { SpecialOpParams, SpecialOpResult } from "../types";

export function resolveCombatInfernalGaze(params: SpecialOpParams): SpecialOpResult | null {
  const {
    save,
    storyPack,
    rng,
    catalogs,
    spell,
    effectDef,
    cnBase,
    validTargetActors,
    getOvercastForTarget,
  } = params;
  const baseResistPenalty = getResistBasePenalty(effectDef, spell.baseCN ?? cnBase);
  if (effectDef.specialOp !== "combatInfernalGaze" || validTargetActors.length === 0) {
    return null;
  }

  let updatedSave = save;
  const resistedTargetIds = new Set<ActorId>();
  const baseOpposedStat = effectDef.opposedStat || "WIL";
  const opposedDifficulty = effectDef.opposedDifficulty || "Challenging";

  for (const target of validTargetActors) {
    const opposedStat = catalogs
      ? getBestResistStat(target.actor, baseOpposedStat, updatedSave, catalogs)
      : baseOpposedStat;
    const magicResistanceBonus = catalogs ? getResistanceBonus(updatedSave, catalogs, target.actorId, "magic") : 0;
    const untouchableDenyBonus = catalogs ? getUntouchableDenyBonus(updatedSave, catalogs, target.actorId) : 0;
    const targetOvercast = getOvercastForTarget(target.actorId);
    const resistModifier = getResistCheckModifier(
      baseResistPenalty,
      targetOvercast,
      magicResistanceBonus,
      untouchableDenyBonus
    );

    const defenderCheck: SingleCheck = {
      id: `combat:cast:infernalGaze:${spell.id}:${target.actorId}`,
      kind: "single",
      actorRef: { mode: "byId", actorId: target.actorId },
      key: opposedStat,
      difficulty: opposedDifficulty,
      modifier: resistModifier,
    };

    const { result: defenderResult, save: saveAfterDefenderCheck } = performCheckWithSave(
      defenderCheck,
      storyPack,
      updatedSave,
      rng,
      `res:infernalGaze:${spell.id}:${target.actorId}`
    );

    updatedSave = saveAfterDefenderCheck;

    if (!defenderResult) {
      resistedTargetIds.add(target.actorId);
      continue;
    }

    if (!defenderResult.success) {
      const damage = Math.max(0, defenderResult.dof);
      const damageResult = applyDamageToActor(target.actor, damage, updatedSave, rng, storyPack, catalogs);
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [target.actorId]: damageResult.updatedActor,
        },
      };
    } else {
      resistedTargetIds.add(target.actorId);
    }
  }

  return { handled: true, save: updatedSave };
}
