import type { ContentPack } from "./types";
import type { Skill, Talent, Trait, CharacterCatalogs, TerrainCatalogs, GridDefinition, TileDefinition } from "./catalogs";
import type { ItemDefinition, Weapon, Armor, ItemId, WeaponId, ArmorId } from "../runtime/types";

function indexById<T extends { id: string }>(arr: T[]): Record<string, T> {
  const result: Record<string, T> = {};
  for (const item of arr) {
    result[item.id] = item;
  }
  return result;
}

/**
 * Loads character catalogs from a content pack
 */
export function loadCharacterCatalogs(contentPack: ContentPack): CharacterCatalogs {
  return {
    skills: contentPack.skills || [],
    talents: contentPack.talents || [],
    traits: contentPack.traits || [],
  };
}

/**
 * Loads terrain catalogs from a content pack
 */
export function loadTerrainCatalogs(contentPack: ContentPack): TerrainCatalogs {
  const gridsById: Record<string, GridDefinition> = {};
  if (contentPack.grids) {
    for (const grid of contentPack.grids) {
      gridsById[grid.id] = grid;
    }
  }

  const tilesById: Record<string, TileDefinition> = {};
  if (contentPack.tiles) {
    Object.assign(tilesById, contentPack.tiles);
  }

  return {
    gridsById,
    tilesById,
  };
}

/**
 * Loads equipment catalogs from a content pack
 */
export function loadEquipmentCatalogs(contentPack: ContentPack): {
  itemsById: Record<ItemId, ItemDefinition>;
  weaponsById: Record<WeaponId, Weapon>;
  armorsById: Record<ArmorId, Armor>;
} {
  return {
    itemsById: contentPack.items ? (indexById(contentPack.items) as Record<ItemId, ItemDefinition>) : {},
    weaponsById: contentPack.weapons ? (indexById(contentPack.weapons) as Record<WeaponId, Weapon>) : {},
    armorsById: contentPack.armors ? (indexById(contentPack.armors) as Record<ArmorId, Armor>) : {},
  };
}

/**
 * Gets a skill by ID from catalogs
 */
export function getSkillById(catalogs: CharacterCatalogs, skillId: string): Skill | undefined {
  return catalogs.skills.find((s) => s.id === skillId);
}

/**
 * Gets a talent by ID from catalogs
 */
export function getTalentById(catalogs: CharacterCatalogs, talentId: string): Talent | undefined {
  return catalogs.talents.find((t) => t.id === talentId);
}

/**
 * Gets a trait by ID from catalogs
 */
export function getTraitById(catalogs: CharacterCatalogs, traitId: string): Trait | undefined {
  return catalogs.traits.find((t) => t.id === traitId);
}

