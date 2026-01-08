import type { Effect, GameSave, ItemRef } from "../../types";
import { getActorInventory } from "../../characters/inventory";
import { getCurrentTurnActorId } from "../combat";
import { getCharacteristicBonus } from "../../characters/bonuses";
import { computeCombatModifiersFromConditions } from "../../conditions";

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
      // Calculate initial movement for this actor
      const agiBonus = getCharacteristicBonus(save, actor.id, "AGI");
      const modifiers = computeCombatModifiersFromConditions(actor);
      const moveDelta = modifiers.moveDelta ?? 0;
      const baseMove = Math.max(1, agiBonus + moveDelta);
      const initialMove = Math.max(1, baseMove);

      // Can only equip if all movement is still remaining
      if (combat.turn.moveRemaining !== initialMove) {
        return { save };
      }
    }
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
