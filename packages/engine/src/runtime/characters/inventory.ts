import type { Actor, ActorId, ArmorId, GameSave, ItemRef, StoryPack, WeaponId } from "../types";
import { loadCharacterCatalogs } from "../../content/loadCatalogs";
import { getCharacteristicBonus } from "./bonuses";

export function getItemRefQty(itemRef: ItemRef): number {
  return itemRef.qty ?? 1;
}

const KG_PER_POUND = 0.45;

function roundCarryKg(weightKg: number): number {
  if (weightKg >= 10) {
    return Math.floor(weightKg);
  }
  return Math.round(weightKg * 100) / 100;
}

function getCarryCapacityPounds(sumBonus: number): number {
  const sum = Math.max(0, Math.floor(sumBonus));

  if (sum <= 0) return 2;

  // 1..4: 5, 10, 20, 40
  if (sum <= 4) {
    return 5 * Math.pow(2, sum - 1);
  }

  // 5..12: 60, 80, 100, 125, 150, 175, 200, 250
  if (sum <= 12) {
    const base = 20 * (sum - 2);
    const extra = sum >= 8 ? 5 * (sum - 7) : 0;
    const extraHigh = sum >= 12 ? 25 : 0;
    return base + extra + extraHigh;
  }

  // 13..19: 500, 750, 1000, 1500, 2000, 3000, 4000
  const offset = sum - 13;
  let pounds = 500 * Math.pow(2, Math.floor(offset / 2)) * (offset % 2 === 1 ? 1.5 : 1);

  // 20+: start from 5000 and keep the 2/1.5 cadence
  if (sum >= 20) {
    const basePounds = 5000;
    if (sum === 20) {
      pounds = basePounds;
    } else {
      const extra = sum - 20;
      pounds = basePounds * Math.pow(2, Math.floor(extra / 2)) * (extra % 2 === 1 ? 1.5 : 1);
    }
  }

  return pounds;
}

export function getCarryCapacityKgFromBonus(sumBonus: number): number {
  return roundCarryKg(getCarryCapacityPounds(sumBonus) * KG_PER_POUND);
}

/**
 * Gets actor inventory (defaults to empty array)
 */
export function getActorInventory(actor: Actor): ItemRef[] {
  return actor.inventory || [];
}

export function getItemRefWeightKg(itemRef: ItemRef, save: GameSave): number {
  if (itemRef.kind === "weapon") {
    return save.weaponsById?.[itemRef.id]?.weight ?? 0;
  }
  if (itemRef.kind === "armor") {
    return save.armorsById?.[itemRef.id]?.weight ?? 0;
  }
  if (itemRef.kind === "item" || itemRef.kind === "misc") {
    return save.itemsById?.[itemRef.id]?.weight ?? 0;
  }
  return 0;
}

export function getActorCarriedWeightKg(save: GameSave, actorId: ActorId): number {
  const actor = save.actorsById[actorId];
  if (!actor) return 0;

  const inventory = getActorInventory(actor);
  let total = 0;

  for (const entry of inventory) {
    const qty = getItemRefQty(entry);
    total += getItemRefWeightKg(entry, save) * qty;
  }

  const equipped = [
    actor.equipment?.mainHand,
    actor.equipment?.offHand,
    actor.equipment?.armor,
    actor.equipment?.helmet,
    actor.equipment?.boots,
    actor.equipment?.cloak,
    actor.equipment?.necklace,
    actor.equipment?.ring1,
    actor.equipment?.ring2,
  ];
  for (const entry of equipped) {
    if (!entry) continue;
    total += getItemRefWeightKg(entry, save) * getItemRefQty(entry);
  }

  return total;
}

export function getActorCarryCapacityKg(save: GameSave, actorId: ActorId, storyPack?: StoryPack): number {
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

  const strBonus = getCharacteristicBonus(save, actorId, "STR", catalogs);
  const touBonus = getCharacteristicBonus(save, actorId, "TOU", catalogs);
  return getCarryCapacityKgFromBonus(strBonus + touBonus);
}

/**
 * Gets the equipped weapon ID from an actor
 */
export function getEquippedWeaponId(actor: Actor): WeaponId | null {
  if (actor.conditions?.beast_form) {
    return null;
  }
  if (actor.equipment?.mainHand?.kind === "weapon") {
    return actor.equipment.mainHand.id as WeaponId;
  }
  return null;
}

/**
 * Gets the equipped armor ID from an actor
 */
export function getEquippedArmorId(actor: Actor): ArmorId | null {
  if (actor.conditions?.beast_form) {
    return null;
  }
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
