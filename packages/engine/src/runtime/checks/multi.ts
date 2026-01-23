import type { MultiCheck, CheckResult, StoryPack, GameSave } from "../types";
import { type IRNG } from "../rng";
import { resolveActor } from "./resolve";
import { getStatOrSkillValue } from "./values";
import { resolveDifficulty } from "./target";
import { rollD100CheckWithFate, type FateRerollContext } from "./fate";

export function performMultiCheck(
  check: MultiCheck,
  storyPack: StoryPack | undefined,
  save: GameSave,
  rng: IRNG,
  fateContext?: FateRerollContext
): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack);
  if (!actor) return null;

  // Try each option, succeed if any succeeds
  for (const option of check.options) {
    const baseValue = getStatOrSkillValue(actor, option.key, save, storyPack);
    const difficultyMod = resolveDifficulty(option.difficulty, storyPack);
    const target = baseValue + difficultyMod;

    const result = rollD100CheckWithFate(check.id, actor.id, target, storyPack, save, rng, fateContext);
    if (result && result.success) {
      return result;
    }
  }

  // All failed, return last result
  const lastOption = check.options[check.options.length - 1];
  const baseValue = getStatOrSkillValue(actor, lastOption.key, save, storyPack);
  const difficultyMod = resolveDifficulty(lastOption.difficulty, storyPack);
  const target = baseValue + difficultyMod;

  return rollD100CheckWithFate(check.id, actor.id, target, storyPack, save, rng, fateContext);
}
