import type { EffectDefinition } from "./types";

/** Resist difficulty per overcast (single fixed rule). */
export const RESIST_PENALTY_PER_OVERCAST = 10;

/**
 * Base penalty to resist from spell power level (when effect does not define resistBasePenalty).
 * Bands: 0-1 → 0, 2-4 → -10, 5-7 → -20, 8-10 → -30, 10+ → -40.
 * High-CN spells get a strong base malus since overcast is scarce at typical PM (10-15).
 */
export function getResistBasePenalty(effectDef: EffectDefinition, baseCN: number): number {
  if (typeof effectDef.resistBasePenalty === "number") {
    return effectDef.resistBasePenalty;
  }
  if (baseCN <= 1) return 0;
  if (baseCN <= 4) return -10;
  if (baseCN <= 7) return -20;
  if (baseCN <= 10) return -30;
  return -40;
}

/**
 * Full modifier for the target's resist check.
 * Formula: basePenalty + (-10 × overcast) + magicResistanceBonus + untouchableDenyBonus.
 * Negative modifier = harder for the target to pass.
 */
export function getResistCheckModifier(
  basePenalty: number,
  targetOvercast: number,
  magicResistanceBonus: number,
  untouchableDenyBonus: number
): number {
  return basePenalty - RESIST_PENALTY_PER_OVERCAST * targetOvercast + magicResistanceBonus + untouchableDenyBonus;
}
