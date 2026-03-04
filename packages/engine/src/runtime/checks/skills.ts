import type { StoryPack, StatKey } from "../types";

/** Max skill rank for modifier cap (max +40 bonus) */
export const SKILL_MAX_RANK = 5;

/**
 * Calculates skill modifier based on rank:
 * - Rank 0 (untrained): -20 penalty
 * - Rank 1: +0 (no bonus/malus)
 * - Rank 2+: +10 per rank above 1 (rank 2 = +10, rank 3 = +20, etc.)
 * - Rank is capped at SKILL_MAX_RANK (5) for modifier calculation
 */
export function getSkillModifierFromRank(rank: number): number {
  const effectiveRank = Math.min(Math.max(0, rank), SKILL_MAX_RANK);
  if (effectiveRank === 0) {
    return -20;
  } else if (effectiveRank === 1) {
    return 0;
  } else {
    return (effectiveRank - 1) * 10;
  }
}

/**
 * Gets the base stat value for a skill from the skill catalog
 */
export function getSkillBaseStat(skillId: string, storyPack?: StoryPack): StatKey | null {
  if (!storyPack) {
    // When storyPack is not available, we can't determine the base stat
    // Return null to indicate unknown (will default to 0 in computeTargetBreakdown)
    return null;
  }
  const skills = storyPack.skills || [];
  const skill = skills.find((s: any) => s.id === skillId);
  return skill?.baseStat || null;
}
