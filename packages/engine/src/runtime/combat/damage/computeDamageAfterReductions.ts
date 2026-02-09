import type { Actor, GameSave } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { getActorArmor } from "../equipment";
import { getCharacteristicBonus } from "../../characters/bonuses";
import { isNaturalWeaponId } from "../../characters/naturalWeapons";
import { runHooks } from "../../hooks";
import type { HookValue } from "../../hooks/types";

export function computeDamageAfterReductions(params: {
  save: GameSave;
  updatedSave: GameSave;
  attacker: Actor;
  defender: Actor;
  rawDamage: number;
  damageFormula: string;
  calculatedWeaponId: string | "unarmed" | "improvised";
  useFallbackWeapon: boolean;
  isUnarmed: boolean;
  catalogs?: CharacterCatalogs;
  facts: Record<string, HookValue>;
}): {
  updatedSave: GameSave;
  rawDamage: number;
  damageFormula: string;
  effectiveSoak: number;
  touBonus: number;
  finalDamage: number;
  weaponForPenetration: GameSave["weaponsById"][string] | null;
  isNaturalWeaponAttack: boolean;
  usesWarpWeapons: boolean;
  armorId?: string;
} {
  const {
    save,
    updatedSave,
    attacker,
    defender,
    rawDamage: baseRawDamage,
    damageFormula: baseFormula,
    calculatedWeaponId,
    useFallbackWeapon,
    isUnarmed: _isUnarmed,
    catalogs,
    facts,
  } = params;

  let nextSave = updatedSave;
  let rawDamage = baseRawDamage;
  let damageFormula = baseFormula;

  const preDamageHooks = runHooks("pre-damage", {
    save: nextSave,
    storyPack: undefined,
    attacker,
    defender,
    weapon: calculatedWeaponId !== "unarmed" && !useFallbackWeapon ? save.weaponsById?.[calculatedWeaponId] : null,
    facts: { ...facts, "damage.stage": "apply" },
  });
  nextSave = preDamageHooks.save;
  rawDamage += preDamageHooks.damageMod;
  if (preDamageHooks.damageMultiplier === 0.5) {
    rawDamage = Math.ceil(rawDamage * 0.5);
  } else {
    rawDamage = Math.max(0, rawDamage * preDamageHooks.damageMultiplier);
  }

  const bonusDamage = facts["damage.bonusDamage"];
  if (typeof bonusDamage === "number" && bonusDamage > 0) {
    damageFormula = damageFormula ? `${damageFormula} + ${bonusDamage} (Vengeance)` : `${bonusDamage} (Vengeance)`;
  }
  const fieryBonus = facts["damage.fieryBonus"];
  if (typeof fieryBonus === "number" && fieryBonus > 0) {
    damageFormula = damageFormula ? `${damageFormula} + ${fieryBonus} (Fiery Form)` : `${fieryBonus} (Fiery Form)`;
  }
  const sanctifiedBonus = facts["damage.sanctifiedBonus"];
  if (typeof sanctifiedBonus === "number" && sanctifiedBonus > 0) {
    damageFormula = damageFormula ? `${damageFormula} + ${sanctifiedBonus} (Sanctified)` : `${sanctifiedBonus} (Sanctified)`;
  }
  const unholyBonus = facts["damage.unholyBonus"];
  if (typeof unholyBonus === "number" && unholyBonus > 0) {
    damageFormula = damageFormula ? `${damageFormula} + ${unholyBonus} (Unholy)` : `${unholyBonus} (Unholy)`;
  }
  const forceBonus = facts["damage.forceBonus"];
  if (typeof forceBonus === "number" && forceBonus > 0) {
    damageFormula = damageFormula ? `${damageFormula} + ${forceBonus} (Force)` : `${forceBonus} (Force)`;
  }
  const magicFueledBonus = facts["damage.magicFueledBonus"];
  if (typeof magicFueledBonus === "number" && magicFueledBonus > 0) {
    damageFormula = damageFormula ? `${damageFormula} + ${magicFueledBonus} (Magic Fueled)` : `${magicFueledBonus} (Magic Fueled)`;
  }

  let { soak, armorId } = getActorArmor(save, defender);
  const preReductionHooks = runHooks("pre-reduction", {
    save: nextSave,
    storyPack: undefined,
    attacker,
    defender,
    weapon: calculatedWeaponId !== "unarmed" && !useFallbackWeapon ? save.weaponsById?.[calculatedWeaponId] : null,
    facts: { ...facts, "damage.stage": "reduction" },
  });
  nextSave = preReductionHooks.save;
  if (preReductionHooks.soakMultiplier === 0.5) {
    soak = Math.ceil(soak * 0.5);
  } else {
    soak = Math.max(0, soak * preReductionHooks.soakMultiplier);
  }

  const weaponForPenetration =
    calculatedWeaponId !== "unarmed" && !useFallbackWeapon ? save.weaponsById?.[calculatedWeaponId] : null;

  const isNaturalWeaponAttack =
    calculatedWeaponId !== "unarmed" && !useFallbackWeapon && isNaturalWeaponId(calculatedWeaponId);
  const usesWarpWeapons = facts["damage.usesWarpWeapons"] === true;
  const basePenetration = weaponForPenetration ? weaponForPenetration.penetration : 0;
  const effectivePenetration = (basePenetration + preReductionHooks.penetrationMod) * preReductionHooks.penetrationMultiplier;

  let effectiveSoak = soak;
  if (weaponForPenetration) {
    effectiveSoak = Math.max(0, soak - effectivePenetration);
  }
  effectiveSoak += preReductionHooks.soakMod;
  let touBonus = getCharacteristicBonus(save, defender.id, "TOU", catalogs);
  touBonus = Math.max(0, touBonus + preReductionHooks.touBonusMod);

  let finalDamage = Math.max(0, rawDamage - effectiveSoak - touBonus);
  if (preReductionHooks.finalDamageMultiplier === 0.5) {
    finalDamage = Math.ceil(finalDamage * 0.5);
  } else {
    finalDamage = Math.max(0, finalDamage * preReductionHooks.finalDamageMultiplier);
  }
  finalDamage = Math.max(0, finalDamage + preReductionHooks.finalDamageMod);

  return {
    updatedSave: nextSave,
    rawDamage,
    damageFormula,
    effectiveSoak,
    touBonus,
    finalDamage,
    weaponForPenetration,
    isNaturalWeaponAttack,
    usesWarpWeapons,
    armorId,
  };
}
