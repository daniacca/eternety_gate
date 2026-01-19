import type { Effect, GameSave } from "../../types";
import { unequipItem } from "../../equipment/management";

/**
 * UnequipItem: moves an equipped item back to inventory
 */
export function combatUnequipItem(
  effect: Extract<Effect, { op: "combatUnequipItem" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return { save };
  }

  const updatedSave = unequipItem(save, effect.actorId, effect.slot);
  return { save: updatedSave };
}

