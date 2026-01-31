import type { ActorId, SingleCheck } from "../../../../types";
import { addConditionToActor } from "../../../../conditions";
import { appendCombatLog } from "../../../narration";
import { performCheckWithSave } from "../../../../checks";
import { getCharacteristicValue } from "../../../../characters/bonuses";
import { getResistanceBonus } from "../../../../characters/talentModifiers";
import { getUntouchableDenyBonus } from "../../../../characters/untouchable";

import type { SpecialOpParams, SpecialOpResult } from "../types";

export function resolveCombatHellchain(params: SpecialOpParams): SpecialOpResult | null {
  const {
    save,
    storyPack,
    rng,
    catalogs,
    combat,
    spell,
    effectDef,
    effectiveDoS,
    effectStatBonus,
    validTargetActors,
    getOvercastForTarget,
  } = params;
  if (effectDef.specialOp !== "combatHellchain" || validTargetActors.length === 0) {
    return null;
  }

  let updatedSave = save;
  const resistedTargetIds = new Set<ActorId>();

  for (const target of validTargetActors) {
    const targetStr = getCharacteristicValue(target.actorId, "STR", updatedSave);
    const targetAgi = getCharacteristicValue(target.actorId, "AGI", updatedSave);
    const opposedStat = targetStr >= targetAgi ? "STR" : "AGI";
    const opposedDifficulty = "Challenging";
    const magicResistanceBonus = catalogs ? getResistanceBonus(updatedSave, catalogs, target.actorId, "magic") : 0;
    const untouchableDenyBonus = catalogs ? getUntouchableDenyBonus(updatedSave, catalogs, target.actorId) : 0;

    const defenderCheck: SingleCheck = {
      id: `combat:cast:hellchain:${spell.id}:${target.actorId}`,
      kind: "single",
      actorRef: { mode: "byId", actorId: target.actorId },
      key: opposedStat,
      difficulty: opposedDifficulty,
      modifier: magicResistanceBonus + untouchableDenyBonus,
    };

    const { result: defenderResult, save: saveAfterDefenderCheck } = performCheckWithSave(
      defenderCheck,
      storyPack,
      updatedSave,
      rng,
      `res:hellchain:${spell.id}:${target.actorId}`
    );

    updatedSave = saveAfterDefenderCheck;

    if (!defenderResult) {
      resistedTargetIds.add(target.actorId);
      continue;
    }

    const attackerDoS = effectiveDoS;
    const defenderDoS = defenderResult.success ? defenderResult.dos : -1;

    if (attackerDoS > defenderDoS) {
      const targetOvercast = getOvercastForTarget(target.actorId);
      const duration = Math.max(1, effectStatBonus + targetOvercast);
      const untilTurnCounter = combat.turnCounter + duration;
      const spellSource = `spell:${spell.id}`;
      let updatedTargetActor = addConditionToActor(
        target.actor,
        "bound",
        1,
        untilTurnCounter,
        spellSource
      );
      updatedTargetActor = addConditionToActor(
        updatedTargetActor,
        "halvedMovement",
        1,
        untilTurnCounter,
        spellSource
      );
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [target.actorId]: updatedTargetActor,
        },
      };
      const targetName = target.actor.name || target.actorId;
      updatedSave = appendCombatLog(updatedSave, `${targetName} viene incatenato dalle catene infernali.`);
    } else {
      resistedTargetIds.add(target.actorId);
      const targetName = target.actor.name || target.actorId;
      updatedSave = appendCombatLog(updatedSave, `${targetName} resiste alle catene infernali.`);
    }
  }

  if (resistedTargetIds.size > 0) {
    const remainingTargets = validTargetActors.filter((t) => !resistedTargetIds.has(t.actorId));
    if (remainingTargets.length === 0) {
      return { handled: true, save: updatedSave };
    }
  }

  return { handled: true, save: updatedSave };
}
