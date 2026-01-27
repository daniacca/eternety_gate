import type { Effect, GameSave, SingleCheck, StoryPack } from "../types";
import type { IRNG } from "../rng";
import { addConditionToActor, removeConditionFromActor, hasCondition } from "../conditions";
import { loadCharacterCatalogs } from "../../content/loadCatalogs";
import { hasTalentHook } from "../characters/talentModifiers";
import { performCheckWithSave } from "../checks";

export function applyAddCondition(
  effect: Extract<Effect, { op: "addCondition" }>,
  save: GameSave,
  storyPack?: StoryPack,
  rng?: IRNG
): GameSave {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return save; // Actor not found, ignore
  }

  let workingSave = save;
  if ((effect.condition === "stunned" || effect.condition === "fatigue") && hasCondition(actor, "frenzy")) {
    return workingSave;
  }
  if (effect.condition === "stunned" && storyPack && rng) {
    const catalogs =
      storyPack?.skills || storyPack?.talents || storyPack?.traits
        ? loadCharacterCatalogs({
            id: storyPack.id,
            items: storyPack.items || [],
            weapons: storyPack.weapons || [],
            armors: storyPack.armors || [],
            skills: storyPack.skills || [],
            talents: storyPack.talents || [],
            traits: storyPack.traits || [],
          })
        : undefined;
    if (catalogs && hasTalentHook(actor, catalogs, "ironJaw")) {
      const ironJawCheck: SingleCheck = {
        id: `combat:ironJaw:${actor.id}`,
        kind: "single",
        actorRef: { mode: "byId", actorId: actor.id },
        key: "TOU",
        difficulty: "Challenging",
      };
      const { result, save: saveAfterCheck } = performCheckWithSave(ironJawCheck, storyPack, workingSave, rng);
      workingSave = {
        ...saveAfterCheck,
        runtime: {
          ...saveAfterCheck.runtime,
          rngCounter: typeof (rng as any).getCounter === "function" ? (rng as any).getCounter() : saveAfterCheck.runtime.rngCounter,
        },
      };
      if (result?.success) {
        return workingSave;
      }
    }
  }

  // Calculate untilTurnCounter if durationTurns is provided
  let untilTurnCounter: number | undefined = undefined;
  if (effect.durationTurns !== undefined && workingSave.runtime.combat?.active) {
    const currentTurnCounter = workingSave.runtime.combat.turnCounter ?? 0;
    untilTurnCounter = currentTurnCounter + effect.durationTurns;
  }

  const currentActor = workingSave.actorsById[effect.actorId] ?? actor;
  const updatedActor = addConditionToActor(currentActor, effect.condition, effect.stacks, untilTurnCounter, effect.source);

  return {
    ...workingSave,
    actorsById: {
      ...workingSave.actorsById,
      [effect.actorId]: updatedActor,
    },
  };
}

export function applyRemoveCondition(effect: Extract<Effect, { op: "removeCondition" }>, save: GameSave): GameSave {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return save; // Actor not found, ignore
  }

  const updatedActor = removeConditionFromActor(actor, effect.condition);

  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
  };
}

