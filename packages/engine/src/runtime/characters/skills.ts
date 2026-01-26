import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs, SkillId } from "../../content/catalogs";
import { getSkillById } from "../../content/loadCatalogs";
import { getCharacteristicValue } from "./bonuses";
import { getModifierTotal } from "./modifiers";

/**
 * Gets skill test target value
 * Formula: baseStatValue + (rank * 5) + modifier("skill:<skillId>.testAdd")
 */
export function getSkillTarget(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  skillId: SkillId
): number {
  const actor = save.actorsById[actorId];
  if (!actor) return 0;

  const skill = getSkillById(catalogs, skillId);
  if (!skill) return 0;

  const baseStatValue = getCharacteristicValue(actorId, skill.baseStat, save);
  const rank = actor.skills[skillId] ?? 0;
  const rankBonus = rank * 5;
  const skillModifier = getModifierTotal(save, catalogs, actorId, `skill.${skillId}.testAdd` as any);

  return baseStatValue + rankBonus + skillModifier;
}

/**
 * Gets the XP cost to train the next rank of a skill.
 * Rank progression costs:
 * 1-5: 200, 400, 600, 800, 1000
 * 6-8: 1400, 1800, 2200
 * 9+: +800 per rank (3000, 3800, 4600, ...)
 */
export function getSkillTrainingCost(currentRank: number): number {
  const nextRank = Math.max(0, currentRank) + 1;
  if (nextRank <= 5) {
    return 200 * nextRank;
  }
  if (nextRank <= 8) {
    return 1000 + 400 * (nextRank - 5);
  }
  return 2200 + 800 * (nextRank - 8);
}

