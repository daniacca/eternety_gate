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

  // Apply optional modifier from check (e.g., -10 for non-Weaver Deny the Witch)
  const checkModifier = check.modifier ?? 0;
  const finalTarget = breakdown.target + checkModifier;

  const result = rollD100Check(check.id, actor.id, finalTarget, storyPack, rng);

  // Add target breakdown tags for debugging
  if (result) {
    result.tags.push(`calc:base=${breakdown.baseValue}`);
    result.tags.push(`calc:diff=${breakdown.difficultyMod}`);
    result.tags.push(`calc:mods=${breakdown.tempModsSum}`);
    if (checkModifier !== 0) {
      result.tags.push(`calc:checkMod=${checkModifier}`);
    }
    result.tags.push(`calc:target=${finalTarget}`);
  }

  return result;
}
