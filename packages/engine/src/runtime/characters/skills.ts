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

