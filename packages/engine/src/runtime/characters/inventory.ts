import type { Actor, ItemRef, WeaponId, ArmorId } from "../types";

export function getItemRefQty(itemRef: ItemRef): number {
  return itemRef.qty ?? 1;
}

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

/**
 * Counts total quantity of an itemId in inventory (sums stacks)
 */
export function getInventoryItemQty(inventory: ItemRef[], itemId: string): number {
  return inventory.reduce((total, entry) => (entry.id === itemId ? total + getItemRefQty(entry) : total), 0);
}

/**
 * Removes qty of an itemId from inventory (supports stacks)
 */
export function removeInventoryItemQty(
  inventory: ItemRef[],
  itemId: string,
  qty: number
): { updatedInventory: ItemRef[]; removedQty: number } {
  let remaining = qty;
  const updated: ItemRef[] = [];

  for (const entry of inventory) {
    if (entry.id !== itemId || remaining <= 0) {
      updated.push(entry);
      continue;
    }

    const stackQty = getItemRefQty(entry);
    if (stackQty <= remaining) {
      remaining -= stackQty;
      continue;
    }

    const newQty = stackQty - remaining;
    remaining = 0;
    updated.push({ ...entry, qty: newQty });
  }

  return { updatedInventory: updated, removedQty: qty - remaining };
}
