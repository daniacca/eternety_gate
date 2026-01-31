import type { CombatAttackCheck, GameSave, CheckResult, ActorId } from "../types";
import { resolveActor } from "../checks";
import { getEquippedWeaponId } from "../characters/inventory";
import { hasWeaponQuality } from "../weaponQualities";

/**
 * Validates ranged attack and applies range band modifiers
 * Returns a blocked CheckResult if validation fails, null if valid
 * Also auto-sets rangeBand modifier if not specified
 */
export function validateAndApplyRangedModifiers(
  combatCheck: CombatAttackCheck,
  save: GameSave,
  dist: number,
  checkId: string,
  actorId: ActorId
): CheckResult | null {
  // a) Check if weapon is actually ranged
  const attacker = resolveActor(combatCheck.attacker.actorRef, save);
  const weaponId = combatCheck.attacker.weaponId ?? (attacker ? getEquippedWeaponId(attacker) : null);
  // Use weaponId directly to look up weapon, not getActorWeapon (which ignores check.weaponId)
  const weapon = weaponId && weaponId !== "unarmed" ? save.weaponsById?.[weaponId] : null;

  if (!weapon || weapon.kind !== "RANGED") {
    return {
      checkId,
      actorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=notRangedWeapon", `combat:dist=${dist}`],
    };
  }

  // b) Check if in melee range (dist <= 1)
  const hasCloseRangeShot = hasWeaponQuality(weapon, "close_range_shot");
  if (dist <= 1 && !hasCloseRangeShot) {
    return {
      checkId,
      actorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=rangedInMelee", `combat:dist=${dist}`],
    };
  }

  // c) Check if out of range (if weapon.range exists and dist > max)
  const weaponRange = weapon.range;
  if (weaponRange !== undefined) {
    if (dist > weaponRange) {
      return {
        checkId,
        actorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=outOfRange", `combat:dist=${dist}`, `combat:weaponRange=${weaponRange}`],
      };
    }
  }
  // Note: If weapon has no range defined, we don't block based on distance (assume unlimited range)

  // d) Auto-set rangeBand based on Chebyshev distance (global rule, independent of weapon)
  // This applies regardless of whether weapon.range exists (range check is separate)
  if (dist <= 1 && hasCloseRangeShot) {
    combatCheck.modifiers = {
      ...combatCheck.modifiers,
      closeRangeShot: true,
    };
  } else if (!combatCheck.modifiers?.rangeBand) {
    let rangeBand: "POINT_BLANK" | "SHORT" | "NORMAL" | "LONG" | "EXTREME";
    
    // Global range band rules based on Chebyshev distance (number of squares)
    if (dist >= 10) {
      rangeBand = "EXTREME"; // -40
    } else if (dist >= 7) {
      rangeBand = "LONG"; // -20
    } else if (dist >= 5) {
      rangeBand = "NORMAL"; // +0
    } else if (dist >= 3) {
      rangeBand = "SHORT"; // +20
    } else {
      // dist 2 (point blank)
      rangeBand = "POINT_BLANK"; // +30
    }
    
    combatCheck.modifiers = {
      ...combatCheck.modifiers,
      rangeBand: rangeBand as any,
    };
  }
  
  // Add distance and weapon range tags for debugging
  if (!combatCheck.modifiers) {
    combatCheck.modifiers = {};
  }
  // Note: We'll add these tags in computeAttackTarget to avoid mutating here

  return null; // Valid
}

