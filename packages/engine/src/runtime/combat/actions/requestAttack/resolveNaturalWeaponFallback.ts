import type { Effect, GameSave } from "../../../types";
import type { loadCharacterCatalogs } from "../../../../content/loadCatalogs";
import {
  getNaturalWeaponProfile,
  getNaturalWeaponProfileFromActor,
  isNaturalWeaponId,
} from "../../../characters/naturalWeapons";

export function resolveNaturalWeaponFallback(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  attacker: GameSave["actorsById"][string],
  currentSave: GameSave,
  catalogs: ReturnType<typeof loadCharacterCatalogs> | undefined,
  weaponIdsToUse: Array<string | null>,
  mainWeaponId?: string | null,
  offWeaponId?: string | null,
): { save: GameSave; weaponIdsToUse: Array<string | null> } {
  if (effect.mode === "MELEE" && !mainWeaponId && !offWeaponId && weaponIdsToUse.length === 1) {
    const requestedWeaponId = weaponIdsToUse[0];
    const shouldUseNatural =
      !requestedWeaponId || isNaturalWeaponId(requestedWeaponId) || !currentSave.weaponsById?.[requestedWeaponId];
    if (shouldUseNatural) {
      const naturalWeapon = catalogs
        ? getNaturalWeaponProfile(currentSave, catalogs, effect.attackerId)
        : getNaturalWeaponProfileFromActor(attacker);
      if (naturalWeapon) {
        const weaponsById = {
          ...(currentSave.weaponsById || {}),
          [naturalWeapon.id]: naturalWeapon,
        };
        return {
          save: {
            ...currentSave,
            weaponsById,
          },
          weaponIdsToUse: [naturalWeapon.id],
        };
      }
    }
  }
  return { save: currentSave, weaponIdsToUse };
}
