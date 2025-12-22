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
 */
export function calculateWeaponDamage(
  save: GameSave,
  attacker: Actor,
  weaponId: WeaponId | "unarmed" | null,
  rng: { nextInt: (min: number, max: number) => number }
): { rawDamage: number; weaponName: string; weaponId: WeaponId | "unarmed" } {
  if (!weaponId || weaponId === "unarmed" || !save.weaponsById?.[weaponId]) {
    // Unarmed: 1d10 + SB
    const dieRoll = rng.nextInt(1, 10);
    const strBonus = Math.floor((attacker.stats.STR ?? 0) / 10);
    const rawDamage = dieRoll + strBonus;
    return {
      rawDamage,
      weaponName: "Unarmed",
      weaponId: "unarmed",
    };
  }

  const weapon = save.weaponsById[weaponId];
  const dieRoll = rng.nextInt(1, weapon.damage.die);
  let rawDamage = dieRoll + weapon.damage.add;

  // Add Strength Bonus if weapon has bonus === "SB"
  if (weapon.damage.bonus === "SB") {
    const strBonus = Math.floor((attacker.stats.STR ?? 0) / 10);
    rawDamage += strBonus;
  }

  return {
    rawDamage,
    weaponName: weapon.name,
    weaponId,
  };
}

