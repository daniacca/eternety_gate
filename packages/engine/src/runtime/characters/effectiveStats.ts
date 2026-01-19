import type { GameSave, ActorId } from "../types";

/**
 * Applies armor AGI cap to an already computed AGI value (base + modifiers).
 * This is used for checks, combat, and movement calculations.
 */
export function applyArmorAgiCap(save: GameSave, actorId: ActorId, agiValue: number): number {
  const actor = save.actorsById[actorId];
  if (!actor) return agiValue;
  const armorRef = actor.equipment?.armor;
  if (!armorRef || armorRef.kind !== "armor") return agiValue;
  const armor = save.armorsById?.[armorRef.id];
  if (!armor || armor.agiMax === undefined || armor.agiMax === null) return agiValue;
  return Math.min(agiValue, armor.agiMax);
}
