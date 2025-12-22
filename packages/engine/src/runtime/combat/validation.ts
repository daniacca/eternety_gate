import type { CombatAttackCheck, GameSave, CheckResult, ActorId } from "../types";
import { resolveActor } from "../checks";
import { getActorWeapon } from "./equipment";

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
  const weaponId = combatCheck.attacker.weaponId ?? attacker?.equipment?.weaponId ?? null;
  const { weapon } = attacker ? getActorWeapon(save, attacker) : { weapon: null };

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
  if (dist <= 1) {
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

  // c) Check if out of range (if weapon.range exists and dist > long)
  const weaponRange = weapon.range;
  if (weaponRange) {
    if (dist > weaponRange.long) {
      return {
        checkId,
        actorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=outOfRange", `combat:dist=${dist}`],
      };
    }

    // d) Auto-set rangeBand if not specified (SHORT/LONG based on weapon.range.short)
    if (!combatCheck.modifiers?.rangeBand) {
      const rangeBand = dist <= weaponRange.short ? "SHORT" : "LONG";
      combatCheck.modifiers = {
        ...combatCheck.modifiers,
        rangeBand: rangeBand as any,
      };
    }
  } else {
    // Fallback to old hardcoded range if weapon has no range
    if (dist > 8) {
      return {
        checkId,
        actorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=outOfRange", `combat:dist=${dist}`],
      };
    }

    // Auto-set rangeBand if not specified (fallback to hardcoded values)
    if (!combatCheck.modifiers?.rangeBand) {
      const rangeBand = dist <= 4 ? "SHORT" : "LONG";
      combatCheck.modifiers = {
        ...combatCheck.modifiers,
        rangeBand: rangeBand as any,
      };
    }
  }

  return null; // Valid
}

