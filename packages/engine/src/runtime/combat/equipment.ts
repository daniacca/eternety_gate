import type { GameSave, Actor, Weapon, Armor, WeaponId, ArmorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getEquippedWeaponId, getEquippedArmorId } from "../characters/inventory";
import { getCharacteristicBonus } from "../characters/bonuses";
import { getRangedDamageBonusFromMightyShot } from "../characters/mightyShot";

/**
 * Gets the equipped weapon for an actor, or returns unarmed weapon data
 */
export function getActorWeapon(save: GameSave, actor: Actor): {
  weapon: Weapon | null;
  weaponId: WeaponId | "unarmed";
  name: string;
} {
  const weaponId = getEquippedWeaponId(actor);
  
  if (!weaponId || !save.weaponsById?.[weaponId]) {
    // Unarmed: MELEE with 1d10 + SB
    return {
      weapon: null,
      weaponId: "unarmed",
      name: "Unarmed",
    };
  }

  return {
    weapon: save.weaponsById[weaponId],
    weaponId,
    name: save.weaponsById[weaponId].name,
  };
}

/**
 * Gets the equipped armor for an actor, or returns no armor data
 */
export function getActorArmor(save: GameSave, actor: Actor): {
  armor: Armor | null;
  armorId: ArmorId | "none";
  name: string;
  soak: number;
} {
  const armorId = getEquippedArmorId(actor);
  
  if (!armorId || !save.armorsById?.[armorId]) {
    return {
      armor: null,
      armorId: "none",
      name: "None",
      soak: 0,
    };
  }

  return {
    armor: save.armorsById[armorId],
    armorId,
    name: save.armorsById[armorId].name,
    soak: save.armorsById[armorId].soak,
  };
}

/**
 * Calculates raw damage for a weapon hit
 * Returns: { rawDamage, weaponName, weaponId }
 * @param mode - Combat mode: "MELEE" always applies STR bonus, "RANGED" never applies STR bonus
 * @param rollsCount - For Righteous Fury: number of rolls to make, take best (default 1)
 * @param catalogs - Character catalogs (optional, required for Mighty Shot)
 */
export function calculateWeaponDamage(
  save: GameSave,
  attacker: Actor,
  weaponId: WeaponId | "unarmed" | null,
  rng: { nextInt: (min: number, max: number) => number },
  mode: "MELEE" | "RANGED",
  rollsCount: number = 1,
  catalogs?: CharacterCatalogs
): { rawDamage: number; weaponName: string; weaponId: WeaponId | "unarmed" } {
  if (!weaponId || weaponId === "unarmed" || !save.weaponsById?.[weaponId]) {
    // Unarmed: 1d5 + STR bonus (always applies STR bonus for unarmed)
    let bestRoll = 0;
    const strBonus = getCharacteristicBonus(save, attacker.id, "STR");
    for (let i = 0; i < rollsCount; i++) {
      const dieRoll = rng.nextInt(1, 5);
      const rollTotal = dieRoll + strBonus;
      if (rollTotal > bestRoll) {
        bestRoll = rollTotal;
      }
    }
    return {
      rawDamage: bestRoll,
      weaponName: "Unarmed",
      weaponId: "unarmed",
    };
  }

  const weapon = save.weaponsById[weaponId];
  let bestDamage = 0;

  // Get Mighty Shot bonus for ranged attacks
  const mightyShotBonus = mode === "RANGED" && catalogs
    ? getRangedDamageBonusFromMightyShot(save, catalogs, attacker.id)
    : 0;

  for (let i = 0; i < rollsCount; i++) {
    // For multi-dice weapons, roll the whole weapon damage once per iteration
    const dieRoll = rng.nextInt(1, weapon.damage.die);
    let rollDamage = dieRoll + weapon.damage.add;

    // MELEE: Always apply STR bonus
    // RANGED: Never apply STR bonus (only weapon base damage + bonuses)
    if (mode === "MELEE") {
      const strBonus = getCharacteristicBonus(save, attacker.id, "STR", catalogs);
      rollDamage += strBonus;
    } else if (mode === "RANGED") {
      // RANGED: Add Mighty Shot bonus (flat bonus, not per roll)
      rollDamage += mightyShotBonus;
    }
    // Note: RANGED mode never adds STR bonus, regardless of weapon.damage.bonus

    if (rollDamage > bestDamage) {
      bestDamage = rollDamage;
    }
  }

  return {
    rawDamage: bestDamage,
    weaponName: weapon.name,
    weaponId,
  };
}

