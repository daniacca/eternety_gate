import type { ActorId, SingleCheck } from "../../../../types";
import { appendCombatLog, appendRuntimeLog } from "../../../narration";
import { performCheckWithSave } from "../../../../checks";
import { applyDamageToActor } from "../../../criticalDamage";
import { getBestResistStat } from "../../../../magic/denyTheWitch";
import { getResistanceBonus } from "../../../../characters/talentModifiers";
import { getUntouchableDenyBonus } from "../../../../characters/untouchable";

import type { SpecialOpParams, SpecialOpResult } from "../types";

export function resolveCombatHaemorrhage(params: SpecialOpParams): SpecialOpResult | null {
  const {
    save,
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell,
    effectDef,
    cnBase,
    effectiveDoS,
    effectStatBonus,
    validTargetActors,
    getOvercastForTarget,
  } = params;
  if (effectDef.specialOp !== "combatHaemorrhage" || validTargetActors.length === 0) {
    return null;
  }

  let updatedSave = save;
  const resistedTargetIds = new Set<ActorId>();
  const baseOpposedStat = effectDef.opposedStat || "TOU";
  const opposedDifficulty = effectDef.opposedDifficulty || "Challenging";

  for (const target of validTargetActors) {
    const opposedStat = catalogs
      ? getBestResistStat(target.actor, baseOpposedStat, updatedSave, catalogs)
      : baseOpposedStat;
    const magicResistanceBonus = catalogs ? getResistanceBonus(updatedSave, catalogs, target.actorId, "magic") : 0;
    const untouchableDenyBonus = catalogs ? getUntouchableDenyBonus(updatedSave, catalogs, target.actorId) : 0;
    const targetOvercast = getOvercastForTarget(target.actorId);
    const resistPenalty = -10 * targetOvercast;

    const defenderCheck: SingleCheck = {
      id: `combat:cast:haemorrhage:${spell.id}:${target.actorId}`,
      kind: "single",
      actorRef: { mode: "byId", actorId: target.actorId },
      key: opposedStat,
      difficulty: opposedDifficulty,
      modifier: magicResistanceBonus + untouchableDenyBonus + resistPenalty,
    };

    const { result: defenderResult, save: saveAfterDefenderCheck } = performCheckWithSave(
      defenderCheck,
      storyPack,
      updatedSave,
      rng,
      `res:haemorrhage:${spell.id}:${target.actorId}`
    );

    updatedSave = saveAfterDefenderCheck;

    if (!defenderResult) {
      resistedTargetIds.add(target.actorId);
      continue;
    }

    const attackerDoS = effectiveDoS;
    const defenderDoS = defenderResult.success ? defenderResult.dos : -1;

    if (attackerDoS > defenderDoS) {
      const damage = Math.max(0, effectStatBonus + defenderResult.dof);
      const damageResult = applyDamageToActor(target.actor, damage, updatedSave, rng, storyPack, catalogs);
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [target.actorId]: damageResult.updatedActor,
        },
      };
      updatedSave = appendCombatLog(
        updatedSave,
        `${target.actor.name || target.actorId} subisce Emorragia (${damage} danni).`
      );
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "damage",
        attackerId: turnActorId,
        defenderId: target.actorId,
        formula: `WIL bonus + DoF (${effectStatBonus} + ${defenderResult.dof})`,
        rolls: [],
        rawDamage: damage,
        soak: 0,
        finalDamage: damage,
        turnCounter: combat.turnCounter,
        tags: [
          `magic:spell=${spell.id}`,
          `magic:effect=${effectDef.id}`,
          `magic:cn=${cnBase}`,
          `magic:dosTotal=${effectiveDoS}`,
          `magic:overcast=${targetOvercast}`,
          `magic:kind=${effectDef.kind}`,
          "magic:haemorrhage=1",
        ],
      });
    } else {
      resistedTargetIds.add(target.actorId);
      const targetName = target.actor.name || target.actorId;
      const resistedLog = `${targetName} resiste all'emorragia (${opposedStat}).`;
      updatedSave = appendCombatLog(updatedSave, resistedLog);
    }
  }

  return { handled: true, save: updatedSave };
}
