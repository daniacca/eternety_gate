import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getCharacteristicBonus } from "../characters/bonuses";
import { getModifierTotal } from "../characters/modifiers";

/**
 * Calculates Power Magic (PM) for an actor
 * PM = base bonus of primary stat + talents + focus
 * 
 * MVP: Uses WIS bonus as primary stat
 * Future: Add talents and focus bonuses
 * 
 * @param save - The game save
 * @param actorId - The actor ID
 * @param catalogs - Optional character catalogs (for future talent/focus support)
 * @returns The Power Magic value
 */
export function getMagicPower(
  save: GameSave,
  actorId: ActorId,
  catalogs?: CharacterCatalogs
): number {
  // MVP: PM = WIS bonus
  const wisBonus = getCharacteristicBonus(save, actorId, "WIL", catalogs);
  
  // Add explicit PM modifiers (talents/traits/conditions/equipment).
  // Example: arcane_attunement_1/2/3 each grants +1 magic.pm
  const pmMod = catalogs ? getModifierTotal(save, catalogs, actorId, "magic.pm") : 0;

  return wisBonus + pmMod;
}

