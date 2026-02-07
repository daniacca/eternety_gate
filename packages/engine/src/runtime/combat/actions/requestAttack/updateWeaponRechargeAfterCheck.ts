import type { Effect, GameSave } from "../../../types";
import { getWeaponQualityRank } from "../../../weaponQualities";

export function updateWeaponRechargeAfterCheck(
  currentSave: GameSave,
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  weaponId: string | null,
  weaponDef: GameSave["weaponsById"][string] | null,
): GameSave {
  if (effect.mode !== "RANGED" || !weaponId || weaponId === "unarmed") return currentSave;
  const rechargeTurns = getWeaponQualityRank(weaponDef, "recharge") ?? 0;
  if (rechargeTurns > 0 && currentSave.runtime.combat) {
    const rechargeUntil = (currentSave.runtime.combat.turnCounter ?? 0) + rechargeTurns;
    const existingRechargeByActor = currentSave.runtime.combat.weaponRechargeUntilTurnCounterByActorId || {};
    const actorRecharge = existingRechargeByActor[effect.attackerId] || {};
    return {
      ...currentSave,
      runtime: {
        ...currentSave.runtime,
        combat: {
          ...currentSave.runtime.combat,
          weaponRechargeUntilTurnCounterByActorId: {
            ...existingRechargeByActor,
            [effect.attackerId]: {
              ...actorRecharge,
              [weaponId]: rechargeUntil,
            },
          },
        },
      },
    };
  }
  return currentSave;
}
