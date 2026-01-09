import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getCharacteristicBonus } from "../characters/bonuses";

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
  
  // Future extension points:
  // - Add talent bonuses (e.g., "talent:magical_aptitude")
  // - Add focus bonuses from equipped items
  
  return wisBonus;
}

