import type { SingleCheck, CheckResult, StoryPack, GameSave } from "../types";
import { type IRNG } from "../rng";
import { resolveActor } from "./resolve";
import { computeTargetBreakdown } from "./target";
import { rollD100Check } from "./evaluation";

export function performSingleCheck(
  check: SingleCheck,
  storyPack: StoryPack | undefined,
  save: GameSave,
  rng: IRNG
): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack);
  if (!actor) return null;

  const breakdown = computeTargetBreakdown(actor, check.key, check.difficulty, save, storyPack);

  const result = rollD100Check(check.id, actor.id, breakdown.target, storyPack, rng);

  // Add target breakdown tags for debugging
  if (result) {
    result.tags.push(`calc:base=${breakdown.baseValue}`);
    result.tags.push(`calc:diff=${breakdown.difficultyMod}`);
    result.tags.push(`calc:mods=${breakdown.tempModsSum}`);
    result.tags.push(`calc:target=${breakdown.target}`);
  }

  return result;
}
