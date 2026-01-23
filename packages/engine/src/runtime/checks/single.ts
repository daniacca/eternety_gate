import type { SingleCheck, CheckResult, StoryPack, GameSave } from "../types";
import { type IRNG } from "../rng";
import { resolveActor } from "./resolve";
import { evaluateCondition } from "../conditions";
import { computeTargetBreakdown } from "./target";
import { rollD100CheckWithFate, type FateRerollContext } from "./fate";

export function performSingleCheck(
  check: SingleCheck,
  storyPack: StoryPack | undefined,
  save: GameSave,
  rng: IRNG,
  fateContext?: FateRerollContext
): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack);
  if (!actor) return null;

  const resolvedDifficulty = resolveDifficulty(check, save);
  const breakdown = computeTargetBreakdown(actor, check.key, resolvedDifficulty, save, storyPack);

  // Apply optional modifier from check (e.g., -10 for non-Weaver Deny the Witch)
  const checkModifier = check.modifier ?? 0;
  const finalTarget = breakdown.target + checkModifier;

  const result = rollD100CheckWithFate(check.id, actor.id, finalTarget, storyPack, save, rng, fateContext);

  // Add target breakdown tags for debugging
  if (result) {
    result.tags.push(`calc:base=${breakdown.baseValue}`);
    result.tags.push(`calc:diff=${breakdown.difficultyMod}`);
    result.tags.push(`calc:mods=${breakdown.tempModsSum}`);
    if (checkModifier !== 0) {
      result.tags.push(`calc:checkMod=${checkModifier}`);
    }
    result.tags.push(`calc:target=${finalTarget}`);
    if (resolvedDifficulty !== check.difficulty) {
      result.tags.push(`calc:diffLabel=${resolvedDifficulty}`);
    }
  }

  return result;
}

function resolveDifficulty(check: SingleCheck, save: GameSave): string {
  if (!check.difficultyByCondition) {
    return check.difficulty;
  }
  for (const rule of check.difficultyByCondition.rules) {
    if (evaluateCondition(rule.when, save)) {
      return rule.difficulty;
    }
  }
  return check.difficultyByCondition.default ?? check.difficulty;
}
