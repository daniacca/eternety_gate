import type { Effect, GameSave } from "../../../types";
import { appendCombatLog } from "../../narration";
import { getActorInventory, getInventoryItemQty, removeInventoryItemQty } from "../../../characters/inventory";
import { hasWeaponQuality, getWeaponQualityRank } from "../../../weaponQualities";
import { isUntouchable } from "../../../characters/untouchable";
import { applyBlockedCheck } from "./applyBlockedCheck";

export function handleRangedWeaponState(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  currentSave: GameSave,
  weaponId: string | null,
  currentTurnCounter: number,
  index: number,
): { save: GameSave; blocked?: GameSave; shouldSkip: boolean } {
  if (effect.mode !== "RANGED") return { save: currentSave, shouldSkip: false };
  const currentAttacker = currentSave.actorsById[effect.attackerId];
  if (!currentAttacker) {
    return { save: currentSave, blocked: currentSave, shouldSkip: true };
  }
  const weapon = weaponId && weaponId !== "unarmed" ? currentSave.weaponsById?.[weaponId] : null;
  const isMagicFueled = hasWeaponQuality(weapon, "magic_fueled");
  if (isMagicFueled && isUntouchable(currentAttacker)) {
    if (index === 0) {
      return {
        save: currentSave,
        blocked: applyBlockedCheck(currentSave, effect.attackerId, ["combat:blocked=untouchable", "combat:blocked=magicFueled"]),
        shouldSkip: true,
      };
    }
    return { save: currentSave, shouldSkip: true };
  }

  const rechargeTurns = getWeaponQualityRank(weapon, "recharge") ?? 0;
  const rechargeUntil =
    weaponId && weaponId !== "unarmed"
      ? currentSave.runtime.combat?.weaponRechargeUntilTurnCounterByActorId?.[effect.attackerId]?.[weaponId]
      : undefined;
  if (rechargeTurns > 0 && rechargeUntil !== undefined && currentTurnCounter < rechargeUntil) {
    if (index === 0) {
      const saveWithLog = appendCombatLog(currentSave, "Weapon recharging.");
      return {
        save: currentSave,
        blocked: applyBlockedCheck(saveWithLog, effect.attackerId, ["combat:blocked=recharge", `combat:rechargeUntil=${rechargeUntil}`]),
        shouldSkip: true,
      };
    }
    return { save: appendCombatLog(currentSave, "Weapon recharging."), shouldSkip: true };
  }

  if (weapon?.ammo && !isMagicFueled) {
    const inventory = getActorInventory(currentAttacker);
    const availableAmmo = getInventoryItemQty(inventory, weapon.ammo.itemId);
    if (availableAmmo < weapon.ammo.consumedPerAttack) {
      if (index === 0) {
        const saveWithLog = appendCombatLog(currentSave, "No ammo.");
        return {
          save: currentSave,
          blocked: applyBlockedCheck(saveWithLog, effect.attackerId, ["combat:blocked=noAmmo"]),
          shouldSkip: true,
        };
      }
      return { save: appendCombatLog(currentSave, "No ammo."), shouldSkip: true };
    }

    const { updatedInventory } = removeInventoryItemQty(
      inventory,
      weapon.ammo.itemId,
      weapon.ammo.consumedPerAttack,
    );
    return {
      save: {
        ...currentSave,
        actorsById: {
          ...currentSave.actorsById,
          [currentAttacker.id]: {
            ...currentAttacker,
            inventory: updatedInventory,
          },
        },
      },
      shouldSkip: false,
    };
  }

  return { save: currentSave, shouldSkip: false };
}
