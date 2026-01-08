import type { Effect, GameSave, ItemRef, ItemRefKind } from "../types";
import { getActorInventory } from "../characters/inventory";

/**
 * Converts ItemKind to ItemRefKind
 */
function itemKindToItemRefKind(itemKind: string): ItemRefKind {
  if (itemKind === "weapon") return "weapon";
  if (itemKind === "armor") return "armor";
  return "misc";
}

export function applyAddItem(effect: Extract<Effect, { op: "addItem" }>, save: GameSave): GameSave {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return save; // Actor not found, ignore
  }

  // Look up item in catalog to determine its kind
  const item = save.itemCatalogById[effect.itemId];
  if (!item) {
    return save; // Item not found in catalog, ignore
  }

  // Convert ItemKind to ItemRefKind
  const itemRefKind = itemKindToItemRefKind(item.kind);
  const itemRef: ItemRef = {
    kind: itemRefKind,
    id: effect.itemId,
  };

  // Add to actor inventory
  const currentInventory = getActorInventory(actor);
  const updatedInventory = [...currentInventory, itemRef];

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
  const updatedInventory = currentInventory.filter((itemRef) => itemRef.id !== effect.itemId);

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

