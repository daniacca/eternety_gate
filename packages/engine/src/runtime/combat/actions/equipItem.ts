import type { Effect, GameSave, ItemRef } from "../../types";
import { getActorInventory } from "../../characters/inventory";

/**
 * EquipItem: equips an item from inventory into a slot (swaps if slot occupied)
 */
export function combatEquipItem(
  effect: Extract<Effect, { op: "combatEquipItem" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return { save };
  }

  const inventory = getActorInventory(actor);
  let itemRef: ItemRef | null = null;
  let updatedInventory = [...inventory];

  // Find item in inventory
  if (effect.inventoryIndex !== undefined) {
    if (effect.inventoryIndex >= 0 && effect.inventoryIndex < inventory.length) {
      itemRef = inventory[effect.inventoryIndex];
      updatedInventory = inventory.filter((_, idx) => idx !== effect.inventoryIndex);
    }
  } else {
    // Find by itemRef
    const index = inventory.findIndex((item) => item.kind === effect.itemRef.kind && item.id === effect.itemRef.id);
    if (index !== -1) {
      itemRef = inventory[index];
      updatedInventory = inventory.filter((_, idx) => idx !== index);
    }
  }

  if (!itemRef) {
    // Item not found in inventory
    return { save };
  }

  // Validate slot compatibility
  if (effect.slot === "mainHand" && itemRef.kind !== "weapon") {
    return { save }; // Can only equip weapons to mainHand
  }
  if (effect.slot === "armor" && itemRef.kind !== "armor") {
    return { save }; // Can only equip armor to armor slot
  }

  // Get currently equipped item (for swap)
  const currentlyEquipped = actor.equipment?.[effect.slot] ?? null;

  // Update actor
  let updatedActor = {
    ...actor,
    inventory: updatedInventory,
    equipment: {
      ...actor.equipment,
      [effect.slot]: itemRef,
    },
  };

  // If slot was occupied, add old item to inventory
  if (currentlyEquipped) {
    updatedActor = {
      ...updatedActor,
      inventory: [...updatedActor.inventory, currentlyEquipped],
    };
  }

  const currentSave: GameSave = {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
  };

  return { save: currentSave };
}

