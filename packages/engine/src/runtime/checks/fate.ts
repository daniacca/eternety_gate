import type { ActorId, CheckResult, GameSave, StoryPack } from "../types";
import type { IRNG } from "../rng";
import { evaluateRoll } from "./evaluation";
import { isFateProtectionActive } from "../characters/fate";
import { runHooks } from "../hooks";
import { buildActorFacts, buildPostCheckFacts } from "../hooks/facts";

export type FateRerollContext = {
  used: boolean;
  actorId?: ActorId;
};

export function createFateRerollContext(): FateRerollContext {
  return { used: false };
}

function canUseFateReroll(save: GameSave, actorId: ActorId, context?: FateRerollContext): boolean {
  if (context?.used) return false;
  const actor = save.actorsById[actorId];
  return isFateProtectionActive(actor);
}

function markFateUsed(context: FateRerollContext | undefined, actorId: ActorId): void {
  if (!context) return;
  context.used = true;
  context.actorId = actorId;
}

export function rollD100CheckWithFate(
  checkId: string,
  actorId: ActorId,
  target: number,
  storyPack: StoryPack | undefined,
  save: GameSave,
  rng: IRNG,
  context?: FateRerollContext
): CheckResult {
  const rollMode = getRollMode(save, actorId, storyPack);
  const firstRoll = rollD100WithMode(rng, rollMode);
  const firstResult = evaluateRoll(firstRoll.roll, target, storyPack, checkId, actorId);

  if (!firstResult) {
    return firstResult;
  }
  if (firstRoll.tags.length > 0) {
    firstResult.tags.push(...firstRoll.tags);
  }

  if (!firstResult.success && canUseFateReroll(save, actorId, context)) {
    const reroll = rollD100WithMode(rng, rollMode);
    const rerollResult = evaluateRoll(reroll.roll, target, storyPack, checkId, actorId);
    if (rerollResult) {
      rerollResult.tags.push("fate:reroll=1", `fate:rerollFrom=${firstRoll.roll}`);
      if (reroll.tags.length > 0) {
        rerollResult.tags.push(...reroll.tags);
      }
      applyPostCheckTags(save, storyPack, actorId, rerollResult);
      markFateUsed(context, actorId);
      return rerollResult;
    }
  }

  applyPostCheckTags(save, storyPack, actorId, firstResult);
  return firstResult;
}

function getRollMode(save: GameSave, actorId: ActorId, storyPack: StoryPack | undefined): "best" | "worst" | "normal" {
  const actor = save.actorsById[actorId];
  if (!actor) return "normal";
  const hookResult = runHooks("pre-check", {
    save,
    storyPack,
    attacker: actor,
    facts: buildActorFacts("attacker", actor),
  });
  if (hookResult.rollMode) return hookResult.rollMode;
  return "normal";
}

function rollD100WithMode(
  rng: IRNG,
  mode: "best" | "worst" | "normal"
): { roll: number; tags: string[] } {
  if (mode === "normal") {
    return { roll: rng.rollD100(), tags: [] };
  }

  const rollA = rng.rollD100();
  const rollB = rng.rollD100();
  const roll = mode === "best" ? Math.min(rollA, rollB) : Math.max(rollA, rollB);
  const tagPrefix = mode === "best" ? "roll:advantage" : "roll:disadvantage";
  return { roll, tags: [tagPrefix, `${tagPrefix}:rolls=${rollA},${rollB}`] };
}

function applyPostCheckTags(
  save: GameSave,
  storyPack: StoryPack | undefined,
  actorId: ActorId,
  result: CheckResult | null
): void {
  if (!result) return;
  const actor = save.actorsById[actorId];
  if (!actor) return;
  const hookResult = runHooks("post-check", {
    save,
    storyPack,
    attacker: actor,
    result,
    facts: buildPostCheckFacts(result),
  });
  if (hookResult.tags.length > 0) {
    result.tags.push(...hookResult.tags);
  }
}
