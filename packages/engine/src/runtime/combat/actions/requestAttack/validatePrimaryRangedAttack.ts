import type { CombatAttackCheck, Effect, GameSave } from "../../../types";
import { validateAndApplyRangedModifiers } from "../../validation";

export function validatePrimaryRangedAttack(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  primaryCheck: CombatAttackCheck,
  save: GameSave,
  dist: number,
): GameSave | null {
  if (effect.mode === "RANGED") {
    const blockedCheck = validateAndApplyRangedModifiers(primaryCheck, save, dist, primaryCheck.id, effect.attackerId);
    if (blockedCheck) {
      return {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      };
    }
  }
  return null;
}
