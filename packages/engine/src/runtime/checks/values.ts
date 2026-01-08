import type {
  StatOrSkillKey,
  GameSave,
  Actor,
  StoryPack,
} from "../types";
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
 * Gets the value of a stat or skill for an actor
 * For skills, returns: baseStat + skillModifier(rank) + equipment bonuses + temp modifiers
 */
export function getStatOrSkillValue(
  actor: Actor,
  key: StatOrSkillKey,
  save: GameSave,
  storyPack?: StoryPack
): number {
  // Check if it's a stat
  if (key in actor.stats) {
    let value = actor.stats[key as keyof typeof actor.stats];

    // Apply equipment bonuses
    const items = getEquippedItems(actor);

    for (const itemId of items) {
      const item = save.itemCatalogById[itemId];
      if (!item) continue;

      for (const mod of item.mods) {
        if (mod.type === "bonusStat" && mod.stat === key) {
          value += mod.value;
        }
      }
    }

    // Apply temp modifiers
    for (const tempMod of actor.status.tempModifiers) {
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
    if (storyPack) {
      const baseStat = getSkillBaseStat(skillId, storyPack);
      if (baseStat && baseStat in actor.stats) {
        baseStatValue = actor.stats[baseStat];
      }
    }

    // Calculate skill modifier from rank
    const skillModifier = getSkillModifierFromRank(rank);

    // Start with base stat + skill modifier
    let value = baseStatValue + skillModifier;

    // Apply equipment bonuses to base stat
    const items = getEquippedItems(actor);
    for (const itemId of items) {
      const item = save.itemCatalogById[itemId];
      if (!item) continue;

      for (const mod of item.mods) {
        if (mod.type === "bonusStat") {
          const baseStat = storyPack ? getSkillBaseStat(skillId, storyPack) : null;
          if (baseStat && mod.stat === baseStat) {
            value += mod.value;
          }
        }
        if (mod.type === "bonusSkill" && mod.skill === skillId) {
          value += mod.value;
        }
      }
    }

    // Apply temp modifiers
    for (const tempMod of actor.status.tempModifiers) {
      if ((tempMod.scope === "check" || tempMod.scope === "all") && (!tempMod.key || tempMod.key === key)) {
        value += tempMod.value;
      }
    }

    return value;
  }

  return 0;
}

