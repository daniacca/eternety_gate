import type { ActorId, CheckResult, GameSave, StoryPack } from "../../../types";
import type { CharacterCatalogs } from "../../../../content/catalogs";
import { RNG } from "../../../rng";
import { performCheckWithSave } from "../../../checks";
import { addConditionToActor } from "../../../conditions";
import { applyDamageToActor } from "../../criticalDamage";
import { appendCombatLog, appendRuntimeLog } from "../../narration";
import { getCombatDamageTracking, resetCombatDamageTrackingForActor, trackCombatSelfDamage } from "../../damageTracking";
import { getUntouchableAuraImpact } from "../../untouchableAura";
import { handleDeathAfterDamage } from "./handleDeathAfterDamage";

export function handleSpiritualInstability(params: {
  updatedSave: GameSave;
  currentActor: GameSave["actorsById"][string];
  currentTurnActorId: ActorId;
  newTurnCounter: number;
  storyPack?: StoryPack;
  catalogs?: CharacterCatalogs;
  last: CheckResult | null;
  prevActorId: ActorId;
  isPlayerActor: boolean;
  actorName: string;
  advanceFn: (save: GameSave) => GameSave;
}): { updatedSave: GameSave; currentActor: GameSave["actorsById"][string]; earlyReturn?: GameSave } {
  const {
    updatedSave,
    currentActor,
    currentTurnActorId,
    newTurnCounter,
    storyPack,
    catalogs,
    last,
    prevActorId,
    isPlayerActor,
    actorName,
    advanceFn,
  } = params;

  if (currentActor.traits?.["trait:spiritual_instability"] === undefined) {
    return {
      updatedSave: resetCombatDamageTrackingForActor(updatedSave, currentTurnActorId),
      currentActor,
    };
  }

  const tracking = getCombatDamageTracking(updatedSave, currentTurnActorId);
  const shouldCheckInstability = tracking.taken > 0 && tracking.dealt <= 0;
  if (!shouldCheckInstability) {
    return {
      updatedSave: resetCombatDamageTrackingForActor(updatedSave, currentTurnActorId),
      currentActor,
    };
  }

  const rng = new RNG(updatedSave.runtime.rngSeed, updatedSave.runtime.rngCounter ?? 0);
  const auraImpact = catalogs ? getUntouchableAuraImpact(updatedSave, catalogs, currentTurnActorId) : null;
  const auraPenalty = auraImpact?.penalty ?? 0;

  const instabilityCheck = {
    id: `combat:spiritualInstability:${currentTurnActorId}:${newTurnCounter}`,
    kind: "single",
    actorRef: { mode: "byId", actorId: currentTurnActorId },
    key: "WIL",
    difficulty: "Challenging",
    modifier: auraPenalty !== 0 ? auraPenalty : undefined,
  } as const;

  const { result, save: saveAfterCheck } = performCheckWithSave(
    instabilityCheck,
    storyPack,
    updatedSave,
    rng,
    `res:spiritualInstability:${currentTurnActorId}:${newTurnCounter}`,
  );

  let nextSave = {
    ...saveAfterCheck,
    runtime: {
      ...saveAfterCheck.runtime,
      rngCounter: rng.getCounter(),
    },
  };

  // Reset tracking for the new turn before applying any backlash damage
  nextSave = resetCombatDamageTrackingForActor(nextSave, currentTurnActorId);
  let nextActor = nextSave.actorsById[currentTurnActorId] || currentActor;

  if (result && !result.success) {
    const backlashDamage = 1 + result.dof;
    const damageResult = applyDamageToActor(nextActor, backlashDamage, nextSave, rng, storyPack, catalogs);
    nextActor = damageResult.updatedActor;

    nextSave = {
      ...nextSave,
      actorsById: {
        ...nextSave.actorsById,
        [currentTurnActorId]: nextActor,
      },
      runtime: {
        ...nextSave.runtime,
        rngCounter: rng.getCounter(),
      },
    };

    if (!damageResult.dieHardUsed && backlashDamage > 0) {
      nextSave = trackCombatSelfDamage(nextSave, currentTurnActorId, backlashDamage);
    }

    for (const effect of damageResult.effects) {
      if (effect.op === "addCondition") {
        const actorToUpdate = nextSave.actorsById[effect.actorId];
        if (actorToUpdate) {
          const updatedActorWithCondition = addConditionToActor(
            actorToUpdate,
            effect.condition,
            effect.stacks,
            effect.durationTurns,
            effect.source,
          );
          nextSave = {
            ...nextSave,
            actorsById: {
              ...nextSave.actorsById,
              [effect.actorId]: updatedActorWithCondition,
            },
          };
        }
      }
    }

    const instabilityLog = isPlayerActor
      ? `La tua instabilita spirituale ti infligge ${backlashDamage} ferite.`
      : `${actorName} subisce ${backlashDamage} ferite per instabilita spirituale.`;
    nextSave = appendCombatLog(nextSave, instabilityLog);

    nextSave = appendRuntimeLog(nextSave, {
      kind: "system",
      message: `Spiritual Instability: ${currentTurnActorId} suffers ${backlashDamage} damage`,
      turnCounter: newTurnCounter,
      tags: [
        "spirit:instability",
        `damage=${backlashDamage}`,
        ...(auraImpact ? [`aura:untouchable=${auraImpact.sourceId}`] : []),
      ],
    });

    const deathResult = handleDeathAfterDamage({
      updatedSave: nextSave,
      currentTurnActorId,
      prevActorId,
      last,
      storyPack,
      isPlayerActor,
      actorName,
      advanceFn,
    });
    if (deathResult) {
      return { updatedSave: nextSave, currentActor: nextActor, earlyReturn: deathResult };
    }
  }

  return { updatedSave: nextSave, currentActor: nextActor };
}
