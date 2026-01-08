import type { Effect, GameSave, ItemRef } from "../../types";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";
import { posKey, getActorInventory, isWeaponItemRef } from "../../inventory";

/**
 * Pickup: picks up item at actor position, adds to inventory, and optionally auto-equips if main hand empty
 */
export function combatPickup(
  effect: Extract<Effect, { op: "combatPickup" }>,
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

  // Check groundItemsByPos structure
  const posKeyStr = posKey(actorPos);
  let itemRef: ItemRef | null = null;
  let updatedGroundItemsByPos: Record<string, ItemRef[]> | undefined = undefined;

  if (combat.groundItemsByPos && combat.groundItemsByPos[posKeyStr] && combat.groundItemsByPos[posKeyStr].length > 0) {
    const itemsAtPos = combat.groundItemsByPos[posKeyStr];
    itemRef = itemsAtPos[0]; // Pick first item
    const remainingItems = itemsAtPos.slice(1);
    // Remove key if empty, otherwise update with remaining items
    if (remainingItems.length === 0) {
      const { [posKeyStr]: _, ...rest } = combat.groundItemsByPos;
      updatedGroundItemsByPos = Object.keys(rest).length > 0 ? rest : undefined;
    } else {
      updatedGroundItemsByPos = {
        ...combat.groundItemsByPos,
        [posKeyStr]: remainingItems,
      };
    }
  }

  if (!itemRef) {
    const logEntry =
      actor.kind === "PC"
        ? `Non c'è nulla da raccogliere qui.`
        : `${actor.name || effect.actorId} cerca di raccogliere qualcosa ma non trova nulla.`;
    // Consume all movement regardless of success/failure
    const updatedCombat = {
      ...combat,
      turn: {
        ...combat.turn,
        moveRemaining: 0,
      },
    };
    const updatedSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: updatedCombat,
      },
    };
    return { save: appendCombatLog(updatedSave, logEntry) };
  }

  // Add item to inventory
  const currentInventory = getActorInventory(actor);
  const updatedInventory = [...currentInventory, itemRef];

  // Check if mainHand is empty and item is a weapon - auto-equip
  const mainHandEmpty = !actor.equipment?.mainHand;
  const isWeapon = isWeaponItemRef(itemRef);
  const shouldAutoEquip = mainHandEmpty && isWeapon;

  let updatedActor = {
    ...actor,
    inventory: updatedInventory,
  };

  if (shouldAutoEquip) {
    // Remove from inventory (since we're equipping it)
    updatedActor = {
      ...updatedActor,
      inventory: currentInventory, // Don't add to inventory, equip instead
      equipment: {
        ...actor.equipment,
        mainHand: itemRef,
      },
    };
  }

  // Update combat state
  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      moveRemaining: 0,
    },
    ...(updatedGroundItemsByPos !== undefined && { groundItemsByPos: updatedGroundItemsByPos }),
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

  let logEntry: string;
  if (shouldAutoEquip) {
    logEntry =
      actor.kind === "PC"
        ? `Raccogli ${itemName} e la equipaggi.`
        : `${actor.name || effect.actorId} raccoglie ${itemName} e la equipaggia.`;
  } else {
    logEntry =
      actor.kind === "PC"
        ? `Raccogli ${itemName} e la metti nell'inventario.`
        : `${actor.name || effect.actorId} raccoglie ${itemName} e la mette nell'inventario.`;
  }

  currentSave = appendCombatLog(currentSave, logEntry);

  return { save: currentSave };
}

