import type { CombatAttackCheck, Effect, GameSave } from "../../../types";
import { getWeaponQualityRank, hasWeaponQuality } from "../../../weaponQualities";
import { validatePrimaryRangedAttack } from "./validatePrimaryRangedAttack";
import { validatePrimaryRangedWeaponState } from "./validatePrimaryRangedWeaponState";

export function validatePrimaryWeaponPrecheck(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  currentSave: GameSave,
  buildCombatCheck: (weaponId: string | null, suffix: string) => CombatAttackCheck,
  primaryWeaponId: string | null,
  dist: number,
  currentTurnCounter: number,
  attacker: GameSave["actorsById"][string],
): { blocked?: GameSave; primaryUsesAoE: boolean } {
  const primaryCheck = buildCombatCheck(primaryWeaponId, "");
  const primaryWeapon =
    primaryWeaponId && primaryWeaponId !== "unarmed" ? currentSave.weaponsById?.[primaryWeaponId] : null;
  const primaryHasSpray = effect.mode === "RANGED" && hasWeaponQuality(primaryWeapon, "spray");
  const primaryBlastRank = effect.mode === "RANGED" ? getWeaponQualityRank(primaryWeapon, "blast") : null;
  const primaryHasBlast = primaryBlastRank !== null && primaryBlastRank > 0;
  const primaryUsesAoE = primaryHasSpray || primaryHasBlast;

  const primaryRangedBlock = !primaryUsesAoE ? validatePrimaryRangedAttack(effect, primaryCheck, currentSave, dist) : null;
  if (primaryRangedBlock) {
    return { blocked: primaryRangedBlock, primaryUsesAoE };
  }

  const primaryWeaponStateBlock = validatePrimaryRangedWeaponState(
    effect,
    currentSave,
    primaryWeaponId,
    currentTurnCounter,
    attacker,
  );
  if (primaryWeaponStateBlock) {
    return { blocked: primaryWeaponStateBlock, primaryUsesAoE };
  }

  return { primaryUsesAoE };
}
