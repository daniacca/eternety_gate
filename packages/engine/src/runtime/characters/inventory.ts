import type { Actor, ItemRef, WeaponId, ArmorId } from "../types";

/**
 * Gets actor inventory (defaults to empty array)
 */
export function getActorInventory(actor: Actor): ItemRef[] {
  return actor.inventory || [];
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

