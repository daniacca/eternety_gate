import type { Actor, CombatAttackCheck, GameSave, StatOrSkillKey } from "../../types";
import { getEquippedWeaponId } from "../../characters/inventory";
import { hasWeaponQuality } from "../../weaponQualities";

/**
 * Resolves the attack stat key based on the check and attacker.
 * Rules:
 * - If the check is a melee attack, return "WS"
 * - If the check is a ranged attack and the weapon is magic fueled, return "WIL"
 * - In all other cases (so, ranged attack and not magic fueled), return "BS"
 * @param check - The combat attack check
 * @param attacker - The attacker actor
 * @param save - The game save
 * @returns The attack stat key
 */
export function resolveAttackStatKey(check: CombatAttackCheck, attacker: Actor, save: GameSave): StatOrSkillKey {
  if (check.attacker.mode === "MELEE") {
    return "WS";
  }
  const weaponId = check.attacker.weaponId ?? getEquippedWeaponId(attacker);
  const attackWeapon = weaponId && weaponId !== "unarmed" ? save.weaponsById?.[weaponId] : null;
  const isMagicFueled = hasWeaponQuality(attackWeapon, "magic_fueled");
  return isMagicFueled ? "WIL" : "BS";
}
