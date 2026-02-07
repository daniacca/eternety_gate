import type { ActorId, CheckResult, GameSave, StoryPack } from "../../../types";
import { RNG } from "../../../rng";
import { hasCondition, getStacks, addConditionToActor } from "../../../conditions";
import { calculateMaxHp } from "../../../characters/hp";
import { applyDamageToActor } from "../../criticalDamage";
import { trackCombatSelfDamage } from "../../damageTracking";
import { appendCombatLog } from "../../narration";
import { handleDeathAfterDamage } from "./handleDeathAfterDamage";

export function applyBleedingEffect(params: {
  updatedSave: GameSave;
  currentActor: GameSave["actorsById"][string];
  currentTurnActorId: ActorId;
  last: CheckResult | null;
  prevActorId: ActorId;
  storyPack?: StoryPack;
  isPlayerActor: boolean;
  actorName: string;
  advanceFn: (save: GameSave) => GameSave;
}): { updatedSave: GameSave; currentActor: GameSave["actorsById"][string]; earlyReturn?: GameSave } {
  const { updatedSave, currentActor, currentTurnActorId, last, prevActorId, storyPack, isPlayerActor, actorName, advanceFn } =
    params;

  if (!hasCondition(currentActor, "bleeding")) {
    return { updatedSave, currentActor };
  }

  const bleedingStacks = getStacks(currentActor, "bleeding");
  const damage = Math.max(1, bleedingStacks);

  const rng = new RNG(updatedSave.runtime.rngSeed, updatedSave.runtime.rngCounter ?? 0);
  const maxHp = calculateMaxHp(updatedSave, currentActor);
  const woundsBefore = currentActor.resources.wounds ?? 0;
  const hpBefore = maxHp - woundsBefore;

  const damageResult = applyDamageToActor(currentActor, damage, updatedSave, rng);
  let nextActor = damageResult.updatedActor;
  const emittedEffects = damageResult.effects;
  let nextSave = updatedSave;

  if (!damageResult.dieHardUsed && damage > 0) {
    nextSave = trackCombatSelfDamage(nextSave, currentTurnActorId, damage);
  }

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

  for (const effect of emittedEffects) {
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

  const woundsAfter = nextActor.resources.wounds ?? 0;
  const hpAfter = maxHp - woundsAfter;
  const bleedingLog = isPlayerActor
    ? `Sanguini e perdi ${damage} HP.`
    : `${actorName} sanguina e perde ${damage} HP.`;
  nextSave = appendCombatLog(nextSave, bleedingLog);

  if (hpAfter === 0 && hpBefore > 0) {
    const criticalLog = isPlayerActor
      ? "Sei entrato nella traccia del danno critico!"
      : `${actorName} è entrato nella traccia del danno critico!`;
    nextSave = appendCombatLog(nextSave, criticalLog);
  }

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

  return { updatedSave: nextSave, currentActor: nextActor };
}
