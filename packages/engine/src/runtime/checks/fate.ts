import type { ActorId, CheckResult, GameSave, StoryPack } from "../types";
import type { IRNG } from "../rng";
import { evaluateRoll } from "./evaluation";
import { isFateProtectionActive } from "../characters/fate";

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
  const firstRoll = rng.rollD100();
  const firstResult = evaluateRoll(firstRoll, target, storyPack, checkId, actorId);

  if (!firstResult) {
    return firstResult;
  }

  if (!firstResult.success && canUseFateReroll(save, actorId, context)) {
    const reroll = rng.rollD100();
    const rerollResult = evaluateRoll(reroll, target, storyPack, checkId, actorId);
    if (rerollResult) {
      rerollResult.tags.push("fate:reroll=1", `fate:rerollFrom=${firstRoll}`);
      markFateUsed(context, actorId);
      return rerollResult;
    }
  }

  return firstResult;
}
