import type {
  StatOrSkillKey,
  GameSave,
  Actor,
  StoryPack,
} from "../types";
import { getStatOrSkillValue } from "./values";
import { getSkillModifierFromRank, getSkillBaseStat } from "./skills";

function getEquippedItems(actor: Actor): string[] {
  const items: string[] = [];
  if (actor.equipment?.mainHand) {
    items.push(actor.equipment.mainHand.id);
  }
  if (actor.equipment?.offHand) {
    items.push(actor.equipment.offHand.id);
  }
  if (actor.equipment?.armor) {
    items.push(actor.equipment.armor.id);
  }
  return items;
}

/**
 * Resolves a difficulty string to a modifier number
 */
export function resolveDifficulty(difficulty: string, storyPack: StoryPack): number {
  const bands = storyPack.systems.checks.difficultyBands;
  return bands[difficulty] ?? 0;
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
  storyPack: StoryPack
): {
  baseValue: number;
  tempModsSum: number;
  difficultyMod: number;
  finalValue: number;
  target: number;
} {
  // Get base value (without temp modifiers for breakdown)
  let baseValue: number;
  if (key in actor.stats) {
    baseValue = actor.stats[key as keyof typeof actor.stats];
    // Apply equipment bonuses to base
    const items = getEquippedItems(actor);

    for (const itemId of items) {
      const item = save.itemCatalogById[itemId];
      if (!item) continue;

      for (const mod of item.mods) {
        if (mod.type === "bonusStat" && mod.stat === key) {
          baseValue += mod.value;
        }
      }
    }
  } else if (key.startsWith("SKILL:")) {
    const skillId = key.substring(6);
    const rank = actor.skills[skillId] || 0;

    // Get base stat for the skill
    const baseStat = getSkillBaseStat(skillId, storyPack);
    if (baseStat && baseStat in actor.stats) {
      baseValue = actor.stats[baseStat];
    } else {
      baseValue = 0;
    }

    // Add skill modifier from rank
    const skillModifier = getSkillModifierFromRank(rank);
    baseValue += skillModifier;

    // Apply equipment bonuses to base stat
    const items = getEquippedItems(actor);
    for (const itemId of items) {
      const item = save.itemCatalogById[itemId];
      if (!item) continue;

      for (const mod of item.mods) {
        if (mod.type === "bonusStat" && baseStat && mod.stat === baseStat) {
          baseValue += mod.value;
        }
        if (mod.type === "bonusSkill" && mod.skill === skillId) {
          baseValue += mod.value;
        }
      }
    }
  } else {
    baseValue = 0;
  }

  const difficultyMod = resolveDifficulty(difficulty, storyPack);

  // Calculate temp modifiers sum for debug tags
  let tempModsSum = 0;
  for (const tempMod of actor.status.tempModifiers) {
    if ((tempMod.scope === "check" || tempMod.scope === "all") && (!tempMod.key || tempMod.key === key)) {
      tempModsSum += tempMod.value;
    }
  }

  // Use getStatOrSkillValue for final value (includes temp modifiers)
  const finalValue = getStatOrSkillValue(actor, key, save, storyPack);
  const target = finalValue + difficultyMod;

  return {
    baseValue,
    tempModsSum,
    difficultyMod,
    finalValue,
    target,
  };
}

