import type { Effect, GameSave, ItemRef, ItemRefKind, StoryPack } from "../types";
import {
  getActorCarryCapacityKg,
  getActorCarriedWeightKg,
  getActorInventory,
  getItemRefQty,
  removeInventoryItemQty,
} from "../characters/inventory";

/**
 * Converts ItemKind to ItemRefKind
 */
function itemTypeToItemRefKind(): ItemRefKind {
  return "item";
}

function addItemToInventory(
  inventory: ItemRef[],
  itemId: string,
  kind: ItemRefKind,
  qty: number,
  maxStack: number
): ItemRef[] {
  if (qty <= 0) return inventory;

  if (maxStack <= 1) {
    const additions = Array.from({ length: qty }, () => ({ kind, id: itemId } as ItemRef));
    return [...inventory, ...additions];
  }

  let remaining = qty;
  const updated = inventory.map((entry) => {
    if (entry.id !== itemId || remaining <= 0) return entry;
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
    updated.push({ kind, id: itemId, qty: stackQty });
  }

  return updated;
}

function getInventoryItemWeight(save: GameSave, kind: ItemRefKind, itemId: string): number | null {
  if (kind === "item" || kind === "misc") {
    return save.itemsById?.[itemId]?.weight ?? 0;
  }
  if (kind === "weapon") {
    return save.weaponsById?.[itemId]?.weight ?? 0;
  }
  if (kind === "armor") {
    return save.armorsById?.[itemId]?.weight ?? 0;
  }
  return 0;
}

export function applyAddItem(
  effect: Extract<Effect, { op: "addItem" }>,
  save: GameSave,
  storyPack?: StoryPack
): GameSave {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return save; // Actor not found, ignore
  }

  // Look up item in catalog to determine its kind
  const item = save.itemsById[effect.itemId];
  if (!item) {
    return save; // Item not found in catalog, ignore
  }

  // Add to actor inventory
  const qty = effect.qty ?? 1;
  const itemRefKind = itemTypeToItemRefKind();
  const currentInventory = getActorInventory(actor);

  const addedWeight = (item.weight ?? 0) * qty;
  const currentWeight = getActorCarriedWeightKg(save, effect.actorId);
  const maxWeight = getActorCarryCapacityKg(save, effect.actorId, storyPack);
  if (currentWeight + addedWeight > maxWeight) {
    return save; // Over carry capacity, skip add
  }

  const updatedInventory = addItemToInventory(
    currentInventory,
    effect.itemId,
    itemRefKind,
    qty,
    item.maxStack ?? 1
  );

  const updatedActor = {
    ...actor,
    inventory: updatedInventory,
  };

  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
  };
}

export function applyAddInventoryItem(
  effect: Extract<Effect, { op: "addInventoryItem" }>,
  save: GameSave,
  storyPack?: StoryPack
): GameSave {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return save;
  }

  const kind = effect.kind as ItemRefKind;
  const itemId = effect.itemId;
  const qty = effect.qty ?? 1;

  if (kind === "item" || kind === "misc") {
    if (!save.itemsById?.[itemId]) return save;
  } else if (kind === "weapon") {
    if (!save.weaponsById?.[itemId]) return save;
  } else if (kind === "armor") {
    if (!save.armorsById?.[itemId]) return save;
  } else {
    return save;
  }

  const itemWeight = getInventoryItemWeight(save, kind, itemId);
  if (itemWeight === null) return save;
  const addedWeight = itemWeight * qty;
  const currentWeight = getActorCarriedWeightKg(save, effect.actorId);
  const maxWeight = getActorCarryCapacityKg(save, effect.actorId, storyPack);
  if (currentWeight + addedWeight > maxWeight) {
    return save;
  }

  const currentInventory = getActorInventory(actor);
  const maxStack = kind === "item" || kind === "misc" ? save.itemsById?.[itemId]?.maxStack ?? 1 : 1;
  const updatedInventory = addItemToInventory(currentInventory, itemId, kind, qty, maxStack);

  const updatedActor = {
    ...actor,
    inventory: updatedInventory,
  };

  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
  };
}

export function applyRemoveItem(effect: Extract<Effect, { op: "removeItem" }>, save: GameSave): GameSave {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return save; // Actor not found, ignore
  }

  // Remove item from actor inventory
  const currentInventory = getActorInventory(actor);
  const qty = effect.qty;
  const updatedInventory =
    qty === undefined
      ? currentInventory.filter((itemRef) => itemRef.id !== effect.itemId)
      : removeInventoryItemQty(currentInventory, effect.itemId, qty).updatedInventory;

  const updatedActor = {
    ...actor,
    inventory: updatedInventory,
  };

  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
  };
}

