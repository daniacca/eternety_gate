import type { GameSave, Actor, Weapon, Armor, WeaponId, ArmorId } from "../types";

/**
 * Gets the equipped weapon for an actor, or returns unarmed weapon data
 */
export function getActorWeapon(save: GameSave, actor: Actor): {
  weapon: Weapon | null;
  weaponId: WeaponId | "unarmed";
  name: string;
} {
  const weaponId = actor.equipment?.weaponId ?? null;
  
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
  const armorId = actor.equipment?.armorId ?? null;
  
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
 * @param rollsCount - For Righteous Fury: number of rolls to make, take best (default 1)
 */
export function calculateWeaponDamage(
  save: GameSave,
  attacker: Actor,
  weaponId: WeaponId | "unarmed" | null,
  rng: { nextInt: (min: number, max: number) => number },
  rollsCount: number = 1
): { rawDamage: number; weaponName: string; weaponId: WeaponId | "unarmed" } {
  if (!weaponId || weaponId === "unarmed" || !save.weaponsById?.[weaponId]) {
    // Unarmed: 1d5 (changed from 1d10)
    let bestRoll = 0;
    for (let i = 0; i < rollsCount; i++) {
      const dieRoll = rng.nextInt(1, 5);
      const strBonus = Math.floor((attacker.stats.STR ?? 0) / 10);
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

  for (let i = 0; i < rollsCount; i++) {
    // For multi-dice weapons, roll the whole weapon damage once per iteration
    const dieRoll = rng.nextInt(1, weapon.damage.die);
    let rollDamage = dieRoll + weapon.damage.add;

    // Add Strength Bonus if weapon has bonus === "SB"
    if (weapon.damage.bonus === "SB") {
      const strBonus = Math.floor((attacker.stats.STR ?? 0) / 10);
      rollDamage += strBonus;
    }

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

