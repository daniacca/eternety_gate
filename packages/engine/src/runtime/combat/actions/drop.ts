import type { Effect, GameSave, ItemRef } from "../../types";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";
import { posKey } from "../../items";
import { getActorInventory, getItemRefQty } from "../../characters/inventory";

/**
 * Drop: drops an item from inventory or equipment to the ground at actor position
 */
export function combatDrop(
  effect: Extract<Effect, { op: "combatDrop" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.actorId) {
    return { save };
  }

  if (combat.turn.moveRemaining <= 0) {
    return { save };
  }

  const actorPos = combat.positions[effect.actorId];
  if (!actorPos) {
    return { save };
  }

  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return { save };
  }

  let itemRef: ItemRef | null = null;
  let updatedActor = { ...actor };

  // Determine what to drop
  if (effect.fromSlot && effect.fromSlot !== "inventory") {
    itemRef = actor.equipment?.[effect.fromSlot] ?? null;
    if (itemRef) {
      updatedActor = {
        ...updatedActor,
        equipment: {
          ...updatedActor.equipment,
          [effect.fromSlot]: null,
        },
      };
    }
  } else if (!effect.fromSlot && !effect.itemRef && effect.inventoryIndex === undefined) {
    // Default: drop equipped mainHand
    itemRef = actor.equipment?.mainHand ?? null;
    if (itemRef) {
      updatedActor = {
        ...updatedActor,
        equipment: {
          ...updatedActor.equipment,
          mainHand: null,
        },
      };
    }
  } else if (effect.fromSlot === "inventory" && effect.inventoryIndex !== undefined) {
    // Drop from inventory
    const inventory = getActorInventory(actor);
    if (effect.inventoryIndex >= 0 && effect.inventoryIndex < inventory.length) {
      const entry = inventory[effect.inventoryIndex];
      const qty = getItemRefQty(entry);
      itemRef = qty > 1 ? { ...entry, qty: 1 } : entry;
      const updatedInventory =
        qty > 1
          ? inventory.map((item, idx) => (idx === effect.inventoryIndex ? { ...item, qty: qty - 1 } : item))
          : inventory.filter((_, idx) => idx !== effect.inventoryIndex);
      updatedActor = {
        ...updatedActor,
        inventory: updatedInventory,
      };
    }
  } else if (effect.itemRef) {
    // Drop specific item (find in inventory or equipment)
    itemRef = effect.itemRef;
    const inventory = getActorInventory(actor);
    const inventoryIndex = inventory.findIndex((item) => item.kind === itemRef!.kind && item.id === itemRef!.id);
    if (inventoryIndex !== -1) {
      const entry = inventory[inventoryIndex];
      const qty = getItemRefQty(entry);
      const updatedInventory =
        qty > 1
          ? inventory.map((item, idx) => (idx === inventoryIndex ? { ...item, qty: qty - 1 } : item))
          : inventory.filter((_, idx) => idx !== inventoryIndex);
      updatedActor = {
        ...updatedActor,
        inventory: updatedInventory,
      };
    } else {
      // Check equipment slots
      const slotKeys: Array<keyof typeof actor.equipment> = [
        "mainHand",
        "offHand",
        "armor",
        "helmet",
        "boots",
        "cloak",
        "necklace",
        "ring1",
        "ring2",
      ];
      const slotKey = slotKeys.find(
        (slot) => actor.equipment?.[slot]?.kind === itemRef.kind && actor.equipment?.[slot]?.id === itemRef.id
      );
      if (!slotKey) {
        return { save };
      }
      updatedActor = {
        ...updatedActor,
        equipment: {
          ...updatedActor.equipment,
          [slotKey]: null,
        },
      };
    }
  }

  if (!itemRef) {
    return { save };
  }

  // Add item to ground at actor position
  const posKeyStr = posKey(actorPos);
  const currentGroundItemsByPos = combat.groundItemsByPos || {};
  const itemsAtPos = currentGroundItemsByPos[posKeyStr] || [];
  const updatedGroundItemsByPos = {
    ...currentGroundItemsByPos,
    [posKeyStr]: [...itemsAtPos, itemRef],
  };

  // Update combat state
  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      moveRemaining: 0,
    },
    groundItemsByPos: updatedGroundItemsByPos,
  };

  let currentSave: GameSave = {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
    },
  };

  // Generate log message
  let itemName = "l'oggetto";
  if (itemRef.kind === "weapon") {
    itemName = save.weaponsById?.[itemRef.id]?.name || "l'arma";
  } else if (itemRef.kind === "armor") {
    itemName = save.armorsById?.[itemRef.id]?.name || "l'armatura";
  } else if (itemRef.kind === "item" || itemRef.kind === "misc") {
    itemName = save.itemsById?.[itemRef.id]?.name || "l'oggetto";
  }

  const logEntry =
    actor.kind === "PC"
      ? `Lasci cadere ${itemName} a terra.`
      : `${actor.name || effect.actorId} lascia cadere ${itemName} a terra.`;
  currentSave = appendCombatLog(currentSave, logEntry);

  return { save: currentSave };
}

