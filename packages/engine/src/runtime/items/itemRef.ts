import type { ItemRef } from "../types";

/**
 * Checks if an item reference is a weapon
 */
export function isWeaponItemRef(itemRef: ItemRef): boolean {
  return itemRef.kind === "weapon";
}

/**
 * Checks if an item reference is armor
 */
export function isArmorItemRef(itemRef: ItemRef): boolean {
  return itemRef.kind === "armor";
}

/**
 * Checks if an item reference is a general item (wearable/consumable)
 */
export function isCatalogItemRef(itemRef: ItemRef): boolean {
  return itemRef.kind === "item" || itemRef.kind === "misc";
}
