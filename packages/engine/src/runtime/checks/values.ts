import type { StatOrSkillKey, GameSave, Actor, StoryPack } from "../types";
import { getSkillModifierFromRank, getSkillBaseStat } from "./skills";
import { loadCharacterCatalogs } from "../../content/loadCatalogs";
import { getModifierTotal } from "../characters/modifiers";
import { applyArmorAgiCap } from "../characters/effectiveStats";

/**
 * Gets the value of a stat or skill for an actor
 * For skills, returns: baseStat + skillModifier(rank) + equipment bonuses + temp modifiers
 */
export function getStatOrSkillValue(
  actor: Actor,
  key: StatOrSkillKey,
  save: GameSave,
  storyPack?: StoryPack
): number {
  const catalogs =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          items: storyPack.items || [],
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;

  // Check if it's a stat
  if (key in actor.stats) {
    const statKey = key as keyof typeof actor.stats;
    let value = actor.stats[statKey];

    if (catalogs) {
      value += getModifierTotal(save, catalogs, actor.id, `stat.${statKey}.testAdd` as any);
    }

    if (statKey === "AGI") {
      value = applyArmorAgiCap(save, actor.id, value);
    }

    // Apply temp modifiers (check expiration)
    const currentTurnCounter = save.runtime.combat?.turnCounter ?? -1;
    for (const tempMod of actor.status.tempModifiers) {
      // Check expiration: if expires is set and current turn >= expires, skip this modifier
      if (tempMod.expires !== undefined && currentTurnCounter >= tempMod.expires) {
        continue;
      }
      if ((tempMod.scope === "check" || tempMod.scope === "all") && (!tempMod.key || tempMod.key === key)) {
        value += tempMod.value;
      }
    }

    return value;
  }

  // Check if it's a skill (SKILL:xxx format)
  if (key.startsWith("SKILL:")) {
    const skillId = key.substring(6);
    const rank = actor.skills[skillId] || 0;

    // Get base stat for the skill
    let baseStatValue = 0;
    const baseStat = storyPack ? getSkillBaseStat(skillId, storyPack) : null;
    if (baseStat && baseStat in actor.stats) {
      baseStatValue = actor.stats[baseStat];
    }
    if (catalogs && baseStat) {
      baseStatValue += getModifierTotal(save, catalogs, actor.id, `stat.${baseStat}.testAdd` as any);
    }
    if (baseStat === "AGI") {
      baseStatValue = applyArmorAgiCap(save, actor.id, baseStatValue);
    }

    // Calculate skill modifier from rank
    const skillModifier = getSkillModifierFromRank(rank);

    // Start with base stat + skill modifier
    let value = baseStatValue + skillModifier;

    if (catalogs) {
      value += getModifierTotal(save, catalogs, actor.id, `skill.${skillId}.mod` as any);
    }

    // Apply temp modifiers (check expiration)
    const currentTurnCounter = save.runtime.combat?.turnCounter ?? -1;
    for (const tempMod of actor.status.tempModifiers) {
      // Check expiration: if expires is set and current turn >= expires, skip this modifier
      if (tempMod.expires !== undefined && currentTurnCounter >= tempMod.expires) {
        continue;
      }
      if ((tempMod.scope === "check" || tempMod.scope === "all") && (!tempMod.key || tempMod.key === key)) {
        value += tempMod.value;
      }
    }

    return value;
  }

  return 0;
}

