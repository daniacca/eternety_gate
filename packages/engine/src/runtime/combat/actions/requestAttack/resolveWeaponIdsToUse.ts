import type { Effect, GameSave } from "../../../types";
import { getDualWieldPenalty } from "./getDualWieldPenalty";

export function resolveWeaponIdsToUse(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  attacker: GameSave["actorsById"][string],
  mainWeaponId?: string | null,
  offWeaponId?: string | null,
): { weaponIdsToUse: Array<string | null>; dualWieldPenalty: number } {
  const dualPenalty = getDualWieldPenalty(attacker);
  const hasDualWeapons = Boolean(mainWeaponId && offWeaponId);
  const canDualWield = hasDualWeapons && dualPenalty !== null;

  const resolveWeaponIds = (): Array<string | null> => {
    if (!canDualWield) {
      return [effect.weaponId ?? mainWeaponId ?? offWeaponId ?? null];
    }
    if (effect.mode === "RANGED") {
      return [mainWeaponId ?? null, offWeaponId ?? null].filter((id) => id !== null) as Array<string | null>;
    }
    return [mainWeaponId ?? null, offWeaponId ?? null].filter((id) => id !== null) as Array<string | null>;
  };

  let weaponIdsToUse = resolveWeaponIds();
  if (weaponIdsToUse.length === 0) {
    weaponIdsToUse = [null];
  }

  const dualWieldPenalty = canDualWield && weaponIdsToUse.length > 1 ? (dualPenalty ?? 0) : 0;
  return { weaponIdsToUse, dualWieldPenalty };
}
