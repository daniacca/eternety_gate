import type { Actor, ItemRef, WeaponId, ArmorId, Position } from "./types";

/**
 * Helper to convert position to key string for groundItemsByPos
 */
export function posKey(pos: Position): string {
  return `${pos.x},${pos.y}`;
}

/**
 * Gets the equipped weapon ID from an actor
 */
export function getEquippedWeaponId(actor: Actor): WeaponId | null {
  if (actor.equipment?.mainHand?.kind === "weapon") {
    return actor.equipment.mainHand.id as WeaponId;
  }
  return null;
}

/**
 * Gets the equipped armor ID from an actor
 */
export function getEquippedArmorId(actor: Actor): ArmorId | null {
  if (actor.equipment?.armor?.kind === "armor") {
    return actor.equipment.armor.id as ArmorId;
  }
  return null;
}

/**
 * Gets actor inventory (defaults to empty array)
 */
export function getActorInventory(actor: Actor): ItemRef[] {
  return actor.inventory || [];
}

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

