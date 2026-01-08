import type { GameSave, ActorId, StatKey } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getModifierTotal } from "./modifiers";

/**
 * Calculates the base bonus from a characteristic value.
 * Formula: floor(value / 10)
 */
export function getCharacteristicBonusBase(value: number): number {
  return Math.floor(value / 10);
}

/**
 * Gets the characteristic value for an actor.
 * Returns 0 if actor or stat doesn't exist.
 */
export function getCharacteristicValue(actorId: ActorId, key: StatKey, save: GameSave): number {
  const actor = save.actorsById[actorId];
  if (!actor) {
    return 0;
  }
  return actor.stats[key] ?? 0;
}

/**
 * Gets bonus modifiers for a characteristic.
 * Includes unnatural characteristic bonus from traits.
 *
 * @param save - The game save
 * @param catalogs - Character catalogs (optional, required for unnatural characteristics)
 * @param actorId - The actor ID
 * @param key - The characteristic key (e.g., "INI", "AGI", "STR")
 * @returns The total modifier to apply to the base bonus
 */
export function getBonusModifiers(
  save: GameSave,
  actorId: ActorId,
  key: StatKey,
  catalogs?: CharacterCatalogs
): number {
  const actor = save.actorsById[actorId];
  if (!actor) {
    return 0;
  }

  let total = 0;

  // Check for unnatural characteristic trait
  if (catalogs) {
    const unnaturalModifier = getModifierTotal(save, catalogs, actorId, `stat.${key}.bonusAdd` as any);
    total += unnaturalModifier;
  }

  // TODO: Extend this to check:
  // - actor.conditions for condition-based modifiers
  // - actor.equipment for item bonuses (via itemCatalogById)
  // - actor.status.tempModifiers for temporary modifiers
  // - active combat effects/buffs

  return total;
}

/**
 * Gets the final characteristic bonus for an actor.
 * This is the base bonus (floor(stat/10)) plus any modifiers (including unnatural).
 *
 * @param save - The game save
 * @param actorId - The actor ID
 * @param key - The characteristic key (e.g., "INI", "AGI", "STR")
 * @param catalogs - Character catalogs (optional, required for unnatural characteristics)
 * @returns The final bonus value
 */
export function getCharacteristicBonus(
  save: GameSave,
  actorId: ActorId,
  key: StatKey,
  catalogs?: CharacterCatalogs
): number {
  const baseValue = getCharacteristicValue(actorId, key, save);
  const baseBonus = getCharacteristicBonusBase(baseValue);
  const modifiers = getBonusModifiers(save, actorId, key, catalogs);

  return baseBonus + modifiers;
}

/**
 * Gets stat test target (stat value + test modifiers)
 */
export function getStatTestTarget(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  statKey: StatKey
): number {
  const actor = save.actorsById[actorId];
  if (!actor) return 0;

  const baseValue = getCharacteristicValue(actorId, statKey, save);
  const testModifier = getModifierTotal(save, catalogs, actorId, `stat.${statKey}.testAdd` as any);

  return baseValue + testModifier;
}

/**
 * Gets the initiative bonus for an actor.
 * This uses the INI characteristic bonus, including modifiers from catalogs (traits, talents).
 *
 * @param save - The game save
 * @param actorId - The actor ID
 * @param catalogs - Character catalogs (optional, required for catalog-based modifiers)
 * @returns The initiative bonus
 */
export function getInitiativeBonus(save: GameSave, actorId: ActorId, catalogs?: CharacterCatalogs): number {
  return getCharacteristicBonus(save, actorId, "INI", catalogs);
}
