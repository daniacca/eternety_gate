import type { GameSave, MagicDensityTier } from "../types";

/** DoS required per 1 MC by density tier */
const DOS_PER_MC: Record<MagicDensityTier, number> = {
  normal: 3,
  concentrated: 2,
  veryDense: 1,
  rarefied: 4,
  almostNull: 5,
};

/**
 * Converts accumulated channel DoS to MC (Mana → usable charges) by density.
 * floor(accumulatedDoS / dosPerMc).
 */
export function channelDoSToMc(accumulatedDoS: number, density: MagicDensityTier): number {
  const dosPerMc = DOS_PER_MC[density];
  return Math.floor(accumulatedDoS / dosPerMc);
}

/**
 * Returns effective magic density for the given context.
 * Prefer combat.magicDensity, then default "normal".
 */
export function getMagicDensity(save: GameSave): MagicDensityTier {
  const combat = save.runtime.combat;
  if (combat?.magicDensity) {
    return combat.magicDensity;
  }
  return "normal";
}
