import type { ActorId, SingleCheck } from "../../../../types";
import { addConditionToActor } from "../../../../conditions";
import { appendCombatLog } from "../../../narration";
import { performCheckWithSave } from "../../../../checks";
import { getBestResistStat } from "../../../../magic/denyTheWitch";
import { getResistanceBonus } from "../../../../characters/talentModifiers";
import { getUntouchableDenyBonus } from "../../../../characters/untouchable";

import type { SpecialOpParams, SpecialOpResult } from "../types";

export function resolveCombatControlMind(params: SpecialOpParams): SpecialOpResult | null {
  const {
    save,
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell,
    effectDef,
    effectiveDoS,
    effectStatBonus,
    validTargetActors,
    getOvercastForTarget,
  } = params;
  if (effectDef.specialOp !== "combatControlMind" || validTargetActors.length === 0) {
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
    const resistPenalty = -10 * targetOvercast;

    const defenderCheck: SingleCheck = {
      id: `combat:cast:controlMind:${spell.id}:${target.actorId}`,
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
      `res:controlMind:${spell.id}:${target.actorId}`
    );

    updatedSave = saveAfterDefenderCheck;

    if (!defenderResult) {
      resistedTargetIds.add(target.actorId);
      continue;
    }

    const attackerDoS = effectiveDoS;
    const defenderDoS = defenderResult.success ? defenderResult.dos : -1;

    if (attackerDoS > defenderDoS) {
      const duration = Math.max(1, effectStatBonus + targetOvercast);
      const untilTurnCounter = combat.turnCounter + duration;
      const spellSource = `spell:${spell.id}`;
      let updatedTargetActor = addConditionToActor(
        target.actor,
        "mind_control",
        1,
        untilTurnCounter,
        spellSource,
        { addedToParty: true }
      );

      const partyActors = updatedSave.party?.actors ?? [];
      const alreadyInParty = partyActors.includes(target.actorId);
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [target.actorId]: updatedTargetActor,
        },
        party: {
          ...updatedSave.party,
          actors: alreadyInParty ? partyActors : [...partyActors, target.actorId],
          activeActorId:
            updatedSave.party.activeActorId && updatedSave.party.activeActorId !== target.actorId
              ? updatedSave.party.activeActorId
              : updatedSave.party.activeActorId ?? turnActorId,
        },
      };
      updatedSave = appendCombatLog(updatedSave, `${target.actor.name || target.actorId} è sotto il tuo controllo.`);
    } else {
      resistedTargetIds.add(target.actorId);
      const targetName = target.actor.name || target.actorId;
      const resistedLog = `${targetName} resiste al controllo mentale (${opposedStat}).`;
      updatedSave = appendCombatLog(updatedSave, resistedLog);
    }
  }

  return { handled: true, save: updatedSave };
}
