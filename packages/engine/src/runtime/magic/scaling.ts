/**
 * Scales damage based on overcast
 * Formula: baseDamage + (2 * overcast) flat damage
 */
export function scaleDamage(
  baseDice: { dice: number; sides: number } | undefined,
  baseFlat: number | undefined,
  overcast: number
): { diceCount: number; diceSides: number; flatPlus: number } {
  const diceCount = baseDice?.dice ?? 0;
  const diceSides = baseDice?.sides ?? 10;
  const baseFlatValue = baseFlat ?? 0;
  const flatPlus = baseFlatValue + 2 * overcast;

  return {
    diceCount,
    diceSides,
    flatPlus,
  };
}

/**
 * Scales condition application based on overcast
 * - stacks += floor(overcast / 2)
 * - duration += overcast
 */
export function scaleCondition(
  baseStacks: number | undefined,
  baseDuration: number | undefined,
  overcast: number
): { stacks: number; durationTurns: number } {
  const baseStacksValue = baseStacks ?? 1;
  const baseDurationValue = baseDuration ?? 1;

  return {
    stacks: baseStacksValue + Math.floor(overcast / 2),
    durationTurns: baseDurationValue + overcast,
  };
}

/**
 * Scales healing based on overcast
 * Formula: baseHeal + overcast
 */
export function scaleHeal(baseHeal: number, overcast: number): number {
  return baseHeal + overcast;
}

/**
 * Base duration for blessing conditions by spell baseCN.
 * Higher CN → higher base (less room for overcast). Bands: 0-1→1, 2-4→2, 5-7→3, 8-10→4, 10+→5.
 */
export function getBlessingBaseDuration(baseCN: number): number {
  if (baseCN <= 1) return 1;
  if (baseCN <= 4) return 2;
  if (baseCN <= 7) return 3;
  if (baseCN <= 10) return 4;
  return 5;
}

/**
 * Base stacks for blessing conditions by spell baseCN.
 * Higher baseCN → higher base (less room for overcast, so base carries more weight).
 * Tuned so a high-PM character (PM ~12, max ~15) gets total stacks in a similar range (≈5–8)
 * across CN: at CN 1 full power OC 5–7 → 1+5..7 = 6–8; at CN 4 OC 2–4 → 3+2..4 = 5–7; etc.
 * Bands: 0-1→1, 2-4→3, 5-7→5, 8-10→6, 10+→7.
 */
export function getBlessingBaseStacks(baseCN: number): number {
  if (baseCN <= 1) return 1;
  if (baseCN <= 4) return 3;
  if (baseCN <= 7) return 5;
  if (baseCN <= 10) return 6;
  return 7;
}

/**
 * Standardized blessing duration and stacks: base from spell baseCN + effectStat + overcast.
 * duration = baseDuration(baseCN) + effectStatBonus + overcast
 * stacks = baseStacks(baseCN) + overcast (1:1 with OC so low-CN spells reach 6–8 at full power)
 */
export function scaleBlessingCondition(
  baseCN: number,
  effectStatBonus: number,
  overcast: number
): { durationTurns: number; stacks: number } {
  const baseDuration = getBlessingBaseDuration(baseCN);
  const baseStacks = getBlessingBaseStacks(baseCN);
  return {
    durationTurns: baseDuration + effectStatBonus + overcast,
    stacks: baseStacks + overcast,
  };
}
