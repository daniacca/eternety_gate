import type { GameSave } from "../../../types";
import { getNaturalAbilityWeapons } from "../../../characters/naturalAbilities";

export function resolveNaturalAbilityFallback(
  attacker: GameSave["actorsById"][string],
  currentSave: GameSave,
  weaponIdsToUse: Array<string | null>,
  mainWeaponId?: string | null,
  offWeaponId?: string | null,
  mode?: "MELEE" | "RANGED",
): Array<string | null> {
  if (!mainWeaponId && !offWeaponId && weaponIdsToUse.length === 1) {
    const requestedWeaponId = weaponIdsToUse[0];
    const hasRequested = requestedWeaponId && currentSave.weaponsById?.[requestedWeaponId];
    const naturalAbilityWeapons = getNaturalAbilityWeapons(attacker);
    if (!hasRequested && naturalAbilityWeapons.length > 0) {
      const matching = naturalAbilityWeapons.find((weapon) => weapon.kind === mode);
      if (matching) {
        return [matching.id];
      }
    }
  }
  return weaponIdsToUse;
}
