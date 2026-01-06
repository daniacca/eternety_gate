import type { GameSave, ActorId, StatKey } from "../types";
import { resolveActor } from "../checks";

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
 * This is a placeholder that returns 0 for now, but can be extended to:
 * - Check actor.conditions for temporary modifiers
 * - Check actor.equipment for item bonuses
 * - Check actor.status.tempModifiers for status effects
 * - Check active combat effects/buffs
 * 
 * @param save - The game save
 * @param actorId - The actor ID
 * @param key - The characteristic key (e.g., "INI", "AGI", "STR")
 * @returns The total modifier to apply to the base bonus
 */
export function getBonusModifiers(save: GameSave, actorId: ActorId, key: StatKey): number {
  const actor = save.actorsById[actorId];
  if (!actor) {
    return 0;
  }

  // TODO: Extend this to check:
  // - actor.conditions for condition-based modifiers
  // - actor.equipment for item bonuses (via itemCatalogById)
  // - actor.status.tempModifiers for temporary modifiers
  // - active combat effects/buffs
  
  // For now, return 0 (no modifiers)
  return 0;
}

/**
 * Gets the final characteristic bonus for an actor.
 * This is the base bonus (floor(stat/10)) plus any modifiers.
 * 
 * @param save - The game save
 * @param actorId - The actor ID
 * @param key - The characteristic key (e.g., "INI", "AGI", "STR")
 * @returns The final bonus value
 */
export function getCharacteristicBonus(save: GameSave, actorId: ActorId, key: StatKey): number {
  const baseValue = getCharacteristicValue(actorId, key, save);
  const baseBonus = getCharacteristicBonusBase(baseValue);
  const modifiers = getBonusModifiers(save, actorId, key);
  
  return baseBonus + modifiers;
}

/**
 * Gets the initiative bonus for an actor.
 * This uses the INI characteristic bonus.
 * 
 * @param save - The game save
 * @param actorId - The actor ID
 * @returns The initiative bonus
 */
export function getInitiativeBonus(save: GameSave, actorId: ActorId): number {
  return getCharacteristicBonus(save, actorId, "INI");
}

