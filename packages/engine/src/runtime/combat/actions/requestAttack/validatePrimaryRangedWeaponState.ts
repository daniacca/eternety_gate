import type { Effect, GameSave } from "../../../types";
import { appendCombatLog } from "../../narration";
import { getActorInventory, getInventoryItemQty } from "../../../characters/inventory";
import { hasWeaponQuality, getWeaponQualityRank } from "../../../weaponQualities";
import { isUntouchable } from "../../../characters/untouchable";
import { applyBlockedCheck } from "./applyBlockedCheck";

export function validatePrimaryRangedWeaponState(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  currentSave: GameSave,
  primaryWeaponId: string | null,
  currentTurnCounter: number,
  attacker: GameSave["actorsById"][string],
): GameSave | null {
  if (effect.mode !== "RANGED") return null;
  const primaryWeapon =
    primaryWeaponId && primaryWeaponId !== "unarmed" ? currentSave.weaponsById?.[primaryWeaponId] : null;
  const isMagicFueled = hasWeaponQuality(primaryWeapon, "magic_fueled");
  if (isMagicFueled && isUntouchable(attacker)) {
    return applyBlockedCheck(currentSave, effect.attackerId, ["combat:blocked=untouchable", "combat:blocked=magicFueled"]);
  }

  const rechargeTurns = getWeaponQualityRank(primaryWeapon, "recharge") ?? 0;
  const rechargeUntil =
    primaryWeaponId && primaryWeaponId !== "unarmed"
      ? currentSave.runtime.combat?.weaponRechargeUntilTurnCounterByActorId?.[effect.attackerId]?.[primaryWeaponId]
      : undefined;
  if (rechargeTurns > 0 && rechargeUntil !== undefined && currentTurnCounter < rechargeUntil) {
    const saveWithLog = appendCombatLog(currentSave, "Weapon recharging.");
    return applyBlockedCheck(saveWithLog, effect.attackerId, [
      "combat:blocked=recharge",
      `combat:rechargeUntil=${rechargeUntil}`,
    ]);
  }

  if (primaryWeapon?.ammo && !isMagicFueled) {
    const inventory = getActorInventory(attacker);
    const availableAmmo = getInventoryItemQty(inventory, primaryWeapon.ammo.itemId);
    if (availableAmmo < primaryWeapon.ammo.consumedPerAttack) {
      const saveWithLog = appendCombatLog(currentSave, "No ammo.");
      return applyBlockedCheck(saveWithLog, effect.attackerId, ["combat:blocked=noAmmo"]);
    }
  }
  return null;
}
