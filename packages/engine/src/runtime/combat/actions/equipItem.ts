import type { Effect, GameSave } from "../../types";
import { getCurrentTurnActorId, calculateInitialMovement } from "../combat";
import { equipItem } from "../../equipment/management";

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

  const updatedSave = equipItem(save, effect.actorId, effect.itemRef, effect.slot);
  if (updatedSave === save) {
    return { save };
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

  const currentSave: GameSave = {
    ...updatedSave,
    runtime: {
      ...updatedSave.runtime,
      ...(updatedCombat ? { combat: updatedCombat } : {}),
    },
  };

  return { save: currentSave };
}
