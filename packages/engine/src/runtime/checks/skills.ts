import type { StoryPack, StatKey } from "../types";

/**
 * Calculates skill modifier based on rank:
 * - Rank 0 (untrained): -20 penalty
 * - Rank 1: +0 (no bonus/malus)
 * - Rank 2+: +10 per rank above 1 (rank 2 = +10, rank 3 = +20, etc.)
 */
export function getSkillModifierFromRank(rank: number): number {
  if (rank === 0) {
    return -20;
  } else if (rank === 1) {
    return 0;
  } else {
    return (rank - 1) * 10;
  }
}

/**
 * Gets the base stat value for a skill from the skill catalog
 */
export function getSkillBaseStat(skillId: string, storyPack: StoryPack): StatKey | null {
  const skills = storyPack.skills || [];
  const skill = skills.find((s: any) => s.id === skillId);
  return skill?.baseStat || null;
}

