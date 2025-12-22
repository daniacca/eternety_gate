import type { Weapon, Armor, WeaponId, ArmorId } from "../runtime/types";

/**
 * Helper to index an array by id
 */
function indexById<T extends { id: string }>(arr: T[]): Record<string, T> {
  const result: Record<string, T> = {};
  for (const item of arr) {
    result[item.id] = item;
  }
  return result;
}

/**
 * Merges global and story weapons into a single map
 * Story weapons with the same id override global weapons
 */
export function mergeWeapons(
  globalWeapons?: Weapon[],
  storyWeapons?: Weapon[]
): Record<WeaponId, Weapon> {
  const result: Record<WeaponId, Weapon> = {};

  // First, add all global weapons
  if (globalWeapons && globalWeapons.length > 0) {
    Object.assign(result, indexById(globalWeapons));
  }

  // Then, override with story weapons (if any)
  if (storyWeapons && storyWeapons.length > 0) {
    Object.assign(result, indexById(storyWeapons));
  }

  return result;
}

/**
 * Merges global and story armors into a single map
 * Story armors with the same id override global armors
 */
export function mergeArmors(
  globalArmors?: Armor[],
  storyArmors?: Armor[]
): Record<ArmorId, Armor> {
  const result: Record<ArmorId, Armor> = {};

  // First, add all global armors
  if (globalArmors && globalArmors.length > 0) {
    Object.assign(result, indexById(globalArmors));
  }

  // Then, override with story armors (if any)
  if (storyArmors && storyArmors.length > 0) {
    Object.assign(result, indexById(storyArmors));
  }

  return result;
}

