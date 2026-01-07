import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getModifierTotal } from "./modifiers";

export type NaturalWeaponProfile = {
  diceCount: number;
  sides: number;
  flat: number;
  pen: number;
};

/**
 * Gets natural weapon profile based on actor's size trait
 * Default size is 4 (Average) if missing
 */
export function getNaturalWeaponProfile(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): NaturalWeaponProfile | null {
  const actor = save.actorsById[actorId];
  if (!actor) return null;

  const hasNaturalWeapons = getModifierTotal(save, catalogs, actorId, "combat.hasNaturalWeapons" as any) > 0;
  if (!hasNaturalWeapons) return null;

  // Get size from trait
  const sizeParams = actor.traits["trait:size"];
  const size = (sizeParams && typeof sizeParams === "object" && typeof sizeParams.size === "number")
    ? sizeParams.size
    : 4; // Default to Average

  // Determine profile based on size
  if (size <= 2) {
    return { diceCount: 0, sides: 0, flat: 1, pen: 0 };
  } else if (size <= 4) {
    return { diceCount: 1, sides: 5, flat: 0, pen: 1 };
  } else if (size === 5) {
    return { diceCount: 1, sides: 10, flat: 0, pen: 2 };
  } else if (size <= 7) {
    return { diceCount: 2, sides: 10, flat: 0, pen: 4 };
  } else {
    return { diceCount: 3, sides: 10, flat: 0, pen: 6 };
  }
}

