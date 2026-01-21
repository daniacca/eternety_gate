import type { GameSave, ItemRef, ItemDefinition, Weapon, Armor, ItemId, WeaponId, ArmorId } from "../types";
import { getActorInventory, getItemRefQty } from "../characters/inventory";
import { appendCombatLog } from "../combat/narration";

export type EquipmentSlot =
  | "mainHand"
  | "offHand"
  | "armor"
  | "helmet"
  | "boots"
  | "cloak"
  | "necklace"
  | "ring1"
  | "ring2";

export type EquipmentCatalogs = {
  itemsById: Record<ItemId, ItemDefinition>;
  weaponsById: Record<WeaponId, Weapon>;
  armorsById: Record<ArmorId, Armor>;
};

export type ResolvedItemDefinition =
  | { kind: "weapon"; def: Weapon }
  | { kind: "armor"; def: Armor }
  | { kind: "item"; def: ItemDefinition };

export type CanEquipResult = { ok: boolean; reason?: string; resolvedSlot?: EquipmentSlot };

const RING_SLOTS: EquipmentSlot[] = ["ring1", "ring2"];

function resolveEquipmentCatalogs(save: GameSave, catalogs?: EquipmentCatalogs): EquipmentCatalogs {
  return (
    catalogs ?? {
      itemsById: save.itemsById ?? {},
      weaponsById: save.weaponsById ?? {},
      armorsById: save.armorsById ?? {},
    }
  );
}

function normalizeItemRefForEquip(itemRef: ItemRef): ItemRef {
  const { qty, ...rest } = itemRef;
  return rest;
}

function getItemMaxStack(def?: ItemDefinition | null): number {
  return def?.maxStack ?? 1;
}

function getItemCategory(def?: ItemDefinition | null): "wearable" | "consumable" | undefined {
  return def?.kind ?? def?.type;
}

function isStackableItem(itemRef: ItemRef, catalogs: EquipmentCatalogs): boolean {
  if (itemRef.kind !== "item" && itemRef.kind !== "misc") return false;
  const def = catalogs.itemsById[itemRef.id];
  return getItemMaxStack(def) > 1;
}

function removeOneFromInventory(
  inventory: ItemRef[],
  itemRef: ItemRef,
  catalogs: EquipmentCatalogs
): { updatedInventory: ItemRef[]; removed?: ItemRef } {
  const index = inventory.findIndex((entry) => entry.kind === itemRef.kind && entry.id === itemRef.id);
  if (index === -1) return { updatedInventory: inventory };
  const entry = inventory[index];
  const qty = getItemRefQty(entry);
  if (isStackableItem(entry, catalogs) && qty > 1) {
    const updated = [...inventory];
    updated[index] = { ...entry, qty: qty - 1 };
    return { updatedInventory: updated, removed: { ...entry, qty: 1 } };
  }
  return {
    updatedInventory: inventory.filter((_, idx) => idx !== index),
    removed: entry,
  };
}

function addItemToInventory(
  inventory: ItemRef[],
  itemRef: ItemRef,
  catalogs: EquipmentCatalogs
): ItemRef[] {
  if (!isStackableItem(itemRef, catalogs)) {
    return [...inventory, itemRef];
  }

  const def = catalogs.itemsById[itemRef.id];
  const maxStack = getItemMaxStack(def);
  const qtyToAdd = getItemRefQty(itemRef);
  if (qtyToAdd <= 0) return inventory;

  let remaining = qtyToAdd;
  const updated = inventory.map((entry) => {
    if (entry.kind !== itemRef.kind || entry.id !== itemRef.id || remaining <= 0) {
      return entry;
    }
    const currentQty = getItemRefQty(entry);
    const space = maxStack - currentQty;
    if (space <= 0) return entry;
    const add = Math.min(space, remaining);
    remaining -= add;
    return { ...entry, qty: currentQty + add };
  });

  while (remaining > 0) {
    const stackQty = Math.min(maxStack, remaining);
    remaining -= stackQty;
    updated.push({ kind: itemRef.kind, id: itemRef.id, qty: stackQty });
  }

  return updated;
}

function resolveSlotForItem(
  actor: GameSave["actorsById"][string],
  resolved: ResolvedItemDefinition,
  targetSlot?: EquipmentSlot
): { slot?: EquipmentSlot; reason?: string } {
  if (targetSlot && resolved.kind !== "weapon") {
    if (resolved.kind === "item" && resolved.def.shield) {
      return { slot: "offHand" };
    }
    return { slot: targetSlot };
  }
  if (resolved.kind === "weapon") {
    const handedness = resolved.def.handedness ?? "oneHand";
    const mainHand = actor.equipment?.mainHand;
    const offHand = actor.equipment?.offHand;
    if (handedness === "twoHand") {
      return { slot: "mainHand" };
    }
    if (!mainHand) {
      return { slot: "mainHand" };
    }
    if (mainHand.kind === "weapon" && !offHand) {
      return { slot: "offHand" };
    }
    return { slot: "mainHand" };
  }

  if (resolved.kind === "armor") {
    return { slot: "armor" };
  }

  if (resolved.kind === "item") {
    if (getItemCategory(resolved.def) !== "wearable" || !resolved.def.slot) {
      return { reason: "Item cannot be equipped." };
    }
    if (resolved.def.shield) {
      return { slot: "offHand" };
    }
    if (resolved.def.slot === "ring") {
      const ring1 = actor.equipment?.ring1;
      const ring2 = actor.equipment?.ring2;
      if (!ring1) return { slot: "ring1" };
      if (!ring2) return { slot: "ring2" };
      return { reason: "No free ring slot." };
    }
    return { slot: resolved.def.slot };
  }

  return { reason: "Item cannot be equipped." };
}

export function getItemDefinition(itemRef: ItemRef, catalogs?: EquipmentCatalogs): ResolvedItemDefinition | null {
  const resolvedCatalogs = catalogs as EquipmentCatalogs | undefined;
  if (!resolvedCatalogs) return null;
  if (itemRef.kind === "weapon") {
    const weapon = resolvedCatalogs.weaponsById[itemRef.id];
    return weapon ? { kind: "weapon", def: weapon } : null;
  }
  if (itemRef.kind === "armor") {
    const armor = resolvedCatalogs.armorsById[itemRef.id];
    return armor ? { kind: "armor", def: armor } : null;
  }
  if (itemRef.kind === "item" || itemRef.kind === "misc") {
    const item = resolvedCatalogs.itemsById[itemRef.id];
    return item ? { kind: "item", def: item } : null;
  }
  return null;
}

export function getItemDisplaySummary(resolved: ResolvedItemDefinition): string {
  if (resolved.kind === "weapon") {
    const addLabel = `${resolved.def.damage.add >= 0 ? "+" : ""}${resolved.def.damage.add}`;
    const tierLabel = `${resolved.def.damage.tier}${addLabel}`;
    const parts = [`Pen ${resolved.def.penetration}`, tierLabel];
    if (resolved.def.range) {
      parts.push(`Rng ${resolved.def.range.short}/${resolved.def.range.long}`);
    }
    if (resolved.def.handedness === "twoHand") {
      parts.push("2H");
    }
    return parts.join(", ");
  }
  if (resolved.kind === "armor") {
    const parts = [`Soak ${resolved.def.soak}`];
    if (resolved.def.agiMax !== undefined) {
      parts.push(`AGI max ${resolved.def.agiMax}`);
    }
    return parts.join(", ");
  }
  if (resolved.kind === "item") {
    if (resolved.def.shield) {
      return `Shield Soak ${resolved.def.shield.soak ?? 0}`;
    }
    if (resolved.def.grants && resolved.def.grants.length > 0) {
      const grant = resolved.def.grants[0];
      if (grant.type === "modifier") {
        if (grant.valueRef) {
          return `${grant.key} +${grant.valueRef}`;
        }
        const valueLabel = `${grant.value >= 0 ? "+" : ""}${grant.value}`;
        return `${grant.key} ${valueLabel}`;
      }
      if (grant.type === "unlockAction") {
        return `Unlock ${grant.actionId}`;
      }
      if (grant.type === "trait") {
        return `Trait ${grant.traitId}`;
      }
    }
    if (resolved.def.slot) {
      return `Slot ${resolved.def.slot}`;
    }
    return "Item";
  }
  return "Item";
}

export function canEquipItem(
  save: GameSave,
  actorId: string,
  itemRef: ItemRef,
  targetSlot?: EquipmentSlot,
  catalogs?: EquipmentCatalogs
): CanEquipResult {
  const actor = save.actorsById[actorId];
  if (!actor) return { ok: false, reason: "Actor not found." };

  const resolvedCatalogs = resolveEquipmentCatalogs(save, catalogs);
  const resolved = getItemDefinition(itemRef, resolvedCatalogs);
  if (!resolved) return { ok: false, reason: "Item definition not found." };

  const { slot, reason } = resolveSlotForItem(actor, resolved, targetSlot);
  if (!slot) return { ok: false, reason: reason ?? "Item cannot be equipped." };

  const inventory = getActorInventory(actor);
  const hasItem = inventory.some((entry) => entry.kind === itemRef.kind && entry.id === itemRef.id);
  if (!hasItem) return { ok: false, reason: "Item not in inventory." };

  if (resolved.kind === "weapon") {
    if (slot !== "mainHand" && slot !== "offHand") {
      return { ok: false, reason: "Weapons can only be equipped in hands." };
    }
    const handedness = resolved.def.handedness ?? "oneHand";
    if (handedness === "twoHand" && slot !== "mainHand") {
      return { ok: false, reason: "Two-handed weapons must be equipped in main hand." };
    }
    if (slot === "offHand") {
      const mainHand = actor.equipment?.mainHand;
      if (mainHand?.kind === "weapon") {
        const mainWeapon = resolvedCatalogs.weaponsById[mainHand.id];
        if (mainWeapon?.handedness === "twoHand") {
          if (handedness === "oneHand") {
            return { ok: true, resolvedSlot: "mainHand" };
          }
          return { ok: false, reason: "Two-handed weapon occupies offhand." };
        }
      }
    }
    return { ok: true, resolvedSlot: slot };
  }

  if (resolved.kind === "armor") {
    if (slot !== "armor") {
      return { ok: false, reason: "Armor can only be equipped in armor slot." };
    }
    return { ok: true, resolvedSlot: slot };
  }

  if (resolved.kind === "item") {
    if (getItemCategory(resolved.def) !== "wearable" || !resolved.def.slot) {
      return { ok: false, reason: "Item cannot be equipped." };
    }
    if (resolved.def.slot === "ring") {
      if (!RING_SLOTS.includes(slot)) {
        return { ok: false, reason: "Ring must be equipped in ring slots." };
      }
    } else if (resolved.def.slot !== slot) {
      return { ok: false, reason: "Item cannot be equipped in that slot." };
    }

    if (slot === "offHand") {
      const mainHand = actor.equipment?.mainHand;
      if (mainHand?.kind === "weapon") {
        const mainWeapon = resolvedCatalogs.weaponsById[mainHand.id];
        if (mainWeapon?.handedness === "twoHand") {
          return { ok: false, reason: "Two-handed weapon occupies offhand." };
        }
      }
    }

    return { ok: true, resolvedSlot: slot };
  }

  return { ok: false, reason: "Item cannot be equipped." };
}

export function equipItem(
  save: GameSave,
  actorId: string,
  itemRef: ItemRef,
  targetSlot?: EquipmentSlot,
  catalogs?: EquipmentCatalogs
): GameSave {
  const actor = save.actorsById[actorId];
  if (!actor) return save;

  const resolvedCatalogs = resolveEquipmentCatalogs(save, catalogs);
  const canEquip = canEquipItem(save, actorId, itemRef, targetSlot, resolvedCatalogs);
  if (!canEquip.ok || !canEquip.resolvedSlot) return save;

  const resolved = getItemDefinition(itemRef, resolvedCatalogs);
  if (!resolved) return save;

  const inventory = getActorInventory(actor);
  const removal = removeOneFromInventory(inventory, itemRef, resolvedCatalogs);
  if (!removal.removed) return save;

  let slot = canEquip.resolvedSlot;
  const equippedRef = normalizeItemRefForEquip(removal.removed);

  // Apply weapon/shield slot rules
  if (resolved.kind === "weapon") {
    const handedness = resolved.def.handedness ?? "oneHand";
    const mainHand = actor.equipment?.mainHand;
    const offHand = actor.equipment?.offHand;
    const mainHandWeapon =
      mainHand?.kind === "weapon" ? resolvedCatalogs.weaponsById[mainHand.id] : null;
    if (handedness === "twoHand") {
      slot = "mainHand";
    } else if (mainHandWeapon?.handedness === "twoHand") {
      slot = "mainHand";
    } else if (!mainHand) {
      slot = "mainHand";
    } else if (mainHand.kind === "weapon" && !offHand) {
      slot = "offHand";
    } else {
      slot = "mainHand";
    }
  } else if (resolved.kind === "item" && resolved.def.shield) {
    slot = "offHand";
  }

  let updatedActor = {
    ...actor,
    inventory: removal.updatedInventory,
    equipment: {
      ...actor.equipment,
      [slot]: equippedRef,
    },
  };

  let updatedSave: GameSave = {
    ...save,
    actorsById: {
      ...save.actorsById,
      [actorId]: updatedActor,
    },
  };

  const itemsToReturn: ItemRef[] = [];
  const currentlyEquipped = actor.equipment?.[slot] ?? null;
  if (currentlyEquipped) {
    itemsToReturn.push(currentlyEquipped);
  }

  if (resolved.kind === "weapon" && (resolved.def.handedness ?? "oneHand") === "twoHand" && slot === "mainHand") {
    const offHand = actor.equipment?.offHand ?? null;
    if (offHand) {
      itemsToReturn.push(offHand);
      updatedActor = {
        ...updatedActor,
        equipment: {
          ...updatedActor.equipment,
          offHand: null,
        },
      };
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [actorId]: updatedActor,
        },
      };
      updatedSave = appendCombatLog(
        updatedSave,
        "Off-hand item was unequipped because the weapon requires two hands."
      );
    }
  }

  if (resolved.kind === "weapon" && (resolved.def.handedness ?? "oneHand") === "oneHand") {
    const mainHand = actor.equipment?.mainHand;
    const offHand = actor.equipment?.offHand;
    if (mainHand?.kind === "weapon" && offHand?.kind === "weapon" && slot === "mainHand") {
      itemsToReturn.push(offHand);
      updatedActor = {
        ...updatedActor,
        equipment: {
          ...updatedActor.equipment,
          offHand: null,
        },
      };
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [actorId]: updatedActor,
        },
      };
    }
  }

  if (itemsToReturn.length > 0) {
    let updatedInventory = updatedActor.inventory;
    for (const entry of itemsToReturn) {
      updatedInventory = addItemToInventory(updatedInventory, entry, resolvedCatalogs);
    }
    updatedActor = {
      ...updatedActor,
      inventory: updatedInventory,
    };
    updatedSave = {
      ...updatedSave,
      actorsById: {
        ...updatedSave.actorsById,
        [actorId]: updatedActor,
      },
    };
  }

  return updatedSave;
}

export function unequipItem(
  save: GameSave,
  actorId: string,
  slotId: EquipmentSlot,
  catalogs?: EquipmentCatalogs
): GameSave {
  const actor = save.actorsById[actorId];
  if (!actor) return save;

  const itemRef = actor.equipment?.[slotId] ?? null;
  if (!itemRef) return save;

  const resolvedCatalogs = resolveEquipmentCatalogs(save, catalogs);
  const updatedInventory = addItemToInventory(getActorInventory(actor), itemRef, resolvedCatalogs);

  const updatedActor = {
    ...actor,
    inventory: updatedInventory,
    equipment: {
      ...actor.equipment,
      [slotId]: null,
    },
  };

  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [actorId]: updatedActor,
    },
  };
}

export function listEquippableInventoryItems(
  save: GameSave,
  actorId: string,
  slotId: EquipmentSlot,
  catalogs?: EquipmentCatalogs
): ItemRef[] {
  const actor = save.actorsById[actorId];
  if (!actor) return [];
  const resolvedCatalogs = resolveEquipmentCatalogs(save, catalogs);
  const inventory = getActorInventory(actor);
  return inventory.filter((itemRef) => canEquipItem(save, actorId, itemRef, slotId, resolvedCatalogs).ok);
}
