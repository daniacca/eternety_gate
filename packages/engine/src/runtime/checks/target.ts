import type { StatOrSkillKey, GameSave, Actor, StoryPack } from "../types";
import { getStatOrSkillValue } from "./values";

/**
 * Default difficulty bands when storyPack is not available
 * Based on Table 1-2: Test Difficulties
 */
const DEFAULT_DIFFICULTY_BANDS: Record<string, number> = {
  Trivial: 60,
  Elementary: 50,
  Simple: 40,
  Easy: 30,
  Routine: 20,
  Ordinary: 10,
  Challenging: 0,
  Difficult: -10,
  Hard: -20,
  "Very Hard": -30,
  Arduous: -40,
  Punishing: -50,
  Hellish: -60,
};

/**
 * Resolves a difficulty string to a modifier number
 */
export function resolveDifficulty(difficulty: string, storyPack?: StoryPack): number {
  if (storyPack) {
    const bands = storyPack.systems.checks.difficultyBands;
    return bands[difficulty] ?? 0;
  }
  // Use defaults when storyPack is not available
  return DEFAULT_DIFFICULTY_BANDS[difficulty] ?? 0;
}

/**
 * Computes target breakdown for a check (base value, temp modifiers, difficulty, final target)
 * Returns all values needed for both target calculation and debug tags
 */
export function computeTargetBreakdown(
  actor: Actor,
  key: StatOrSkillKey,
  difficulty: string,
  save: GameSave,
  storyPack?: StoryPack
): {
  baseValue: number;
  tempModsSum: number;
  difficultyMod: number;
  finalValue: number;
  target: number;
} {
  const difficultyMod = resolveDifficulty(difficulty, storyPack);

  // Calculate temp modifiers sum for debug tags
  let tempModsSum = 0;
  const currentTurnCounter = save.runtime.combat?.turnCounter ?? -1;
  for (const tempMod of actor.status.tempModifiers) {
    // Check expiration: if expires is set and current turn >= expires, skip this modifier
    if (tempMod.expires !== undefined && currentTurnCounter >= tempMod.expires) {
      continue;
    }
    if ((tempMod.scope === "check" || tempMod.scope === "all") && (!tempMod.key || tempMod.key === key)) {
      tempModsSum += tempMod.value;
    }
  }
  // Use getStatOrSkillValue for final value (includes temp modifiers)
  const finalValue = getStatOrSkillValue(actor, key, save, storyPack);
  const baseValue = finalValue - tempModsSum;
  const target = finalValue + difficultyMod;

  return {
    baseValue,
    tempModsSum,
    difficultyMod,
    finalValue,
    target,
  };
}
