import type { ActorId, GameSave, StoryPack } from "../../../types";
import { RNG } from "../../../rng";
import { hasCondition, removeConditionFromActor } from "../../../conditions";
import { performCheckWithSave } from "../../../checks";
import { appendCombatLog } from "../../narration";

export function handleBoundEscape(params: {
  updatedSave: GameSave;
  currentActor: GameSave["actorsById"][string];
  currentTurnActorId: ActorId;
  newTurnCounter: number;
  newTurnState: GameSave["runtime"]["combat"]["turn"];
  storyPack?: StoryPack;
  isPlayerActor: boolean;
  actorName: string;
}): {
  updatedSave: GameSave;
  currentActor: GameSave["actorsById"][string];
  newTurnState: GameSave["runtime"]["combat"]["turn"];
} {
  const {
    updatedSave,
    currentActor,
    currentTurnActorId,
    newTurnCounter,
    newTurnState,
    storyPack,
    isPlayerActor,
    actorName,
  } = params;

  if (!hasCondition(currentActor, "bound")) {
    return { updatedSave, currentActor, newTurnState };
  }

  const boundCondition = currentActor.conditions?.bound;
  if (boundCondition?.untilTurnCounter === undefined || boundCondition.untilTurnCounter < newTurnCounter) {
    return { updatedSave, currentActor, newTurnState };
  }

  const nextTurnState = {
    ...newTurnState,
    moveRemaining: 0,
  };

  const rng = new RNG(updatedSave.runtime.rngSeed, updatedSave.runtime.rngCounter ?? 0);
  const escapeCheck = {
    id: `combat:bound:escape:${currentTurnActorId}`,
    kind: "single",
    actorRef: { mode: "byId", actorId: currentTurnActorId },
    key: "STR",
    difficulty: "-20",
  } as const;

  const { result, save: saveAfterCheck } = performCheckWithSave(
    escapeCheck,
    storyPack,
    updatedSave,
    rng,
    `res:bound:escape:${currentTurnActorId}`,
  );

  let nextSave = {
    ...saveAfterCheck,
    runtime: {
      ...saveAfterCheck.runtime,
      rngCounter: rng.getCounter(),
    },
  };

  let nextActor = currentActor;
  if (result && result.success) {
    nextActor = removeConditionFromActor(currentActor, "bound");
    nextSave = {
      ...nextSave,
      actorsById: {
        ...nextSave.actorsById,
        [currentTurnActorId]: nextActor,
      },
    };
    const escapeLog = isPlayerActor ? "Riesci a liberarti dai legami!" : `${actorName} riesce a liberarsi dai legami!`;
    nextSave = appendCombatLog(nextSave, escapeLog);
  } else {
    const boundLog = isPlayerActor ? "Sei legato e non puoi muoverti." : `${actorName} è legato e non può muoversi.`;
    nextSave = appendCombatLog(nextSave, boundLog);
  }

  return { updatedSave: nextSave, currentActor: nextActor, newTurnState: nextTurnState };
}
