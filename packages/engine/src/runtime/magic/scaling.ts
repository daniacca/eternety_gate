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
