import type { Effect, GameSave, ItemRef } from "../../types";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";
import { posKey } from "../../items";
import { getActorInventory } from "../../characters/inventory";

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
  if (effect.fromSlot === "mainHand" || (!effect.fromSlot && !effect.itemRef && !effect.inventoryIndex)) {
    // Drop equipped mainHand (default behavior)
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
  } else if (effect.fromSlot === "offHand") {
    itemRef = actor.equipment?.offHand ?? null;
    if (itemRef) {
      updatedActor = {
        ...updatedActor,
        equipment: {
          ...updatedActor.equipment,
          offHand: null,
        },
      };
    }
  } else if (effect.fromSlot === "armor") {
    itemRef = actor.equipment?.armor ?? null;
    if (itemRef) {
      updatedActor = {
        ...updatedActor,
        equipment: {
          ...updatedActor.equipment,
          armor: null,
        },
      };
    }
  } else if (effect.fromSlot === "inventory" && effect.inventoryIndex !== undefined) {
    // Drop from inventory
    const inventory = getActorInventory(actor);
    if (effect.inventoryIndex >= 0 && effect.inventoryIndex < inventory.length) {
      itemRef = inventory[effect.inventoryIndex];
      updatedActor = {
        ...updatedActor,
        inventory: inventory.filter((_, idx) => idx !== effect.inventoryIndex),
      };
    }
  } else if (effect.itemRef) {
    // Drop specific item (find in inventory or equipment)
    itemRef = effect.itemRef;
    const inventory = getActorInventory(actor);
    const inventoryIndex = inventory.findIndex((item) => item.kind === itemRef!.kind && item.id === itemRef!.id);
    if (inventoryIndex !== -1) {
      updatedActor = {
        ...updatedActor,
        inventory: inventory.filter((_, idx) => idx !== inventoryIndex),
      };
    } else {
      // Check equipment slots
      if (actor.equipment?.mainHand?.kind === itemRef.kind && actor.equipment.mainHand.id === itemRef.id) {
        updatedActor = {
          ...updatedActor,
          equipment: {
            ...updatedActor.equipment,
            mainHand: null,
          },
        };
      } else if (actor.equipment?.offHand?.kind === itemRef.kind && actor.equipment.offHand.id === itemRef.id) {
        updatedActor = {
          ...updatedActor,
          equipment: {
            ...updatedActor.equipment,
            offHand: null,
          },
        };
      } else if (actor.equipment?.armor?.kind === itemRef.kind && actor.equipment.armor.id === itemRef.id) {
        updatedActor = {
          ...updatedActor,
          equipment: {
            ...updatedActor.equipment,
            armor: null,
          },
        };
      } else {
        // Item not found
        return { save };
      }
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
  }

  const logEntry =
    actor.kind === "PC"
      ? `Lasci cadere ${itemName} a terra.`
      : `${actor.name || effect.actorId} lascia cadere ${itemName} a terra.`;
  currentSave = appendCombatLog(currentSave, logEntry);

  return { save: currentSave };
}

