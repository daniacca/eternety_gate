import type { CastMode } from "../types";

/**
 * MC spent for the given mode. CN is minimum to manifest.
 * FETTERED: MC = CN.
 * FULL_POWER: MC = max(CN, PM).
 * PUSH: MC = PM + 2 (must be >= CN; if PM+2 < CN we bump to CN).
 */
export function getMcSpentForMode(mode: CastMode, cnBase: number, pm: number): number {
  if (mode === "FETTERED") {
    return cnBase;
  }
  if (mode === "FULL_POWER") {
    return Math.max(cnBase, pm);
  }
  // PUSH: PM + 2
  const raw = pm + 2;
  return Math.max(cnBase, raw);
}

/**
 * Cast modifier from control margin: (PM - MC_SPENT) * 10.
 * Full Power => 0, Push => -20, Fettered => positive when PM > CN.
 */
export function getCastModifierForMode(pm: number, mcSpent: number): number {
  return (pm - mcSpent) * 10;
}

/**
 * Overcast level from extra MC above CN: floor((MC_SPENT - CN) / 2), min 0.
 */
export function getOvercastLevel(mcSpent: number, cnBase: number): number {
  const extra = mcSpent - cnBase;
  return Math.max(0, Math.floor(extra / 2));
}
