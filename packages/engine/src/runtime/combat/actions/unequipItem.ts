import type { Effect, GameSave } from "../../types";
import { getActorInventory } from "../../characters/inventory";

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

  const itemRef = actor.equipment?.[effect.slot] ?? null;
  if (!itemRef) {
    return { save }; // Slot is empty
  }

  const inventory = getActorInventory(actor);
  const updatedActor = {
    ...actor,
    inventory: [...inventory, itemRef],
    equipment: {
      ...actor.equipment,
      [effect.slot]: null,
    },
  };

  const currentSave: GameSave = {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
  };

  return { save: currentSave };
}

