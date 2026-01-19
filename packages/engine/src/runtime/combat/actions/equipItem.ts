import type { Effect, GameSave, ItemRef } from "../../types";
import { getActorInventory, getItemRefQty } from "../../characters/inventory";
import { getCurrentTurnActorId, calculateInitialMovement } from "../combat";

/**
 * EquipItem: equips an item from inventory into a slot (swaps if slot occupied)
 * - Outside combat: equips without any restrictions
 * - In combat: Consumes ALL movement for the round (unless actor has quick_draw talent)
 * - In combat: Can only be performed if all movement is still remaining (unless quick_draw talent)
 * - In combat: Can only be performed once per round (even with quick_draw talent)
 */
export function combatEquipItem(
  effect: Extract<Effect, { op: "combatEquipItem" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return { save };
  }

  const combat = save.runtime.combat;
  const isInCombat = combat?.active === true;

  // If in combat, apply combat-specific restrictions
  if (isInCombat) {
    const turnActorId = getCurrentTurnActorId(save);
    if (!turnActorId || turnActorId !== effect.actorId) {
      return { save };
    }

    // Check if actor has quick_draw talent
    const hasQuickDraw = (actor.talents["talent:quick_draw"] ?? 0) >= 1;

    // Check once-per-round restriction (applies even with quick_draw)
    const equippedThisRoundByActorId = combat.equippedThisRoundByActorId || {};
    const lastEquipRound = equippedThisRoundByActorId[effect.actorId];
    if (lastEquipRound === combat.round) {
      // Already equipped this round
      return { save };
    }

    // If no quick_draw talent, check if all movement is remaining
    if (!hasQuickDraw) {
      // Calculate initial movement for this actor (includes size modifier)
      const initialMove = calculateInitialMovement(actor, save);

      // Can only equip if all movement is still remaining
      if (combat.turn.moveRemaining !== initialMove) {
        return { save };
      }
    }
  }

  const inventory = getActorInventory(actor);
  let itemRef: ItemRef | null = null;
  let updatedInventory = [...inventory];

  function normalizeItemRefForEquip(ref: ItemRef): ItemRef {
    const { qty, ...rest } = ref;
    return rest;
  }

  function tryRemoveFromInventoryByIndex(index: number): { ref: ItemRef; updated: ItemRef[] } | null {
    if (index < 0 || index >= inventory.length) return null;
    const entry = inventory[index];
    const qty = getItemRefQty(entry);
    if (qty > 1) {
      const updated = [...inventory];
      updated[index] = { ...entry, qty: qty - 1 };
      return { ref: { ...entry, qty: 1 }, updated };
    }
    return { ref: entry, updated: inventory.filter((_, idx) => idx !== index) };
  }

  function tryRemoveFromInventoryByRef(ref: ItemRef): { ref: ItemRef; updated: ItemRef[] } | null {
    const index = inventory.findIndex((item) => item.kind === ref.kind && item.id === ref.id);
    if (index === -1) return null;
    return tryRemoveFromInventoryByIndex(index);
  }

  // Find item in inventory
  if (effect.inventoryIndex !== undefined) {
    const result = tryRemoveFromInventoryByIndex(effect.inventoryIndex);
    if (result) {
      itemRef = result.ref;
      updatedInventory = result.updated;
    }
  } else {
    // Find by itemRef
    const result = tryRemoveFromInventoryByRef(effect.itemRef);
    if (result) {
      itemRef = result.ref;
      updatedInventory = result.updated;
    }
  }

  if (!itemRef) {
    // Item not found in inventory
    return { save };
  }

  // Validate slot compatibility
  const normalizedRef = normalizeItemRefForEquip(itemRef);
  const itemKind = normalizedRef.kind;
  const itemDef = itemKind === "item" || itemKind === "misc" ? save.itemsById?.[normalizedRef.id] : null;

  if (effect.slot === "mainHand") {
    const canEquipMainHand =
      itemKind === "weapon" || (itemDef && itemDef.type === "wearable" && itemDef.slot === "mainHand");
    if (!canEquipMainHand) {
      return { save };
    }
  }
  if (effect.slot === "offHand") {
    const canEquipOffHand = itemDef && itemDef.type === "wearable" && itemDef.slot === "offHand";
    if (!canEquipOffHand) {
      return { save };
    }
  }
  if (effect.slot === "armor" && itemKind !== "armor") {
    return { save };
  }
  if (["helmet", "boots", "cloak", "necklace"].includes(effect.slot)) {
    if (!itemDef || itemDef.type !== "wearable" || itemDef.slot !== effect.slot) {
      return { save };
    }
  }
  if (effect.slot === "ring1" || effect.slot === "ring2") {
    if (!itemDef || itemDef.type !== "wearable" || itemDef.slot !== "ring") {
      return { save };
    }
  }

  // Get currently equipped item (for swap)
  const currentlyEquipped = actor.equipment?.[effect.slot] ?? null;

  // Update actor
  let updatedActor = {
    ...actor,
    inventory: updatedInventory,
    equipment: {
      ...actor.equipment,
      [effect.slot]: normalizedRef,
    },
  };

  // If slot was occupied, add old item to inventory
  if (currentlyEquipped) {
    updatedActor = {
      ...updatedActor,
      inventory: [...updatedActor.inventory, currentlyEquipped],
    };
  }

  // If in combat, update combat state: consume all movement (unless quick_draw) and track equipping this round
  let updatedCombat: typeof combat | undefined = undefined;
  if (isInCombat && combat) {
    const hasQuickDraw = (actor.talents["talent:quick_draw"] ?? 0) >= 1;
    const equippedThisRoundByActorId = combat.equippedThisRoundByActorId || {};

    updatedCombat = {
      ...combat,
      turn: {
        ...combat.turn,
        moveRemaining: hasQuickDraw ? combat.turn.moveRemaining : 0, // Consume all movement unless quick_draw
      },
      equippedThisRoundByActorId: {
        ...equippedThisRoundByActorId,
        [effect.actorId]: combat.round,
      },
    };
  }

  // Update save with equipped actor and combat state
  const currentSave: GameSave = {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
    runtime: {
      ...save.runtime,
      ...(updatedCombat ? { combat: updatedCombat } : {}),
    },
  };

  return { save: currentSave };
}
