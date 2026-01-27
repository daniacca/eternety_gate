import type {
  GameSave,
  Actor,
  Weapon,
  Armor,
  WeaponId,
  ArmorId,
  ItemDefinition,
  ItemId,
} from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getEquippedWeaponId, getEquippedArmorId } from "../characters/inventory";
import { getNaturalWeaponProfileFromActor } from "../characters/naturalWeapons";
import { getNaturalAbilityWeapons } from "../characters/naturalAbilities";
import { getCharacteristicBonus } from "../characters/bonuses";
import { getRangedDamageBonusFromMightyShot } from "../characters/mightyShot";
import { getMeleeDamageBonusFromTalents, getRangedDamageBonusFromTalents } from "../characters/talentModifiers";
import { getWeaponQualityRank } from "../weaponQualities";

export type EquipmentCatalogs = {
  itemsById: Record<ItemId, ItemDefinition>;
  weaponsById: Record<WeaponId, Weapon>;
  armorsById: Record<ArmorId, Armor>;
};

function resolveEquipmentCatalogs(save: GameSave, catalogs?: EquipmentCatalogs): EquipmentCatalogs {
  return (
    catalogs ?? {
      itemsById: save.itemsById || {},
      weaponsById: save.weaponsById || {},
      armorsById: save.armorsById || {},
    }
  );
}

/**
 * Resolves equipped weapon definition for an actor
 */
export function getEquippedWeapon(
  save: GameSave,
  actorId: string,
  catalogs?: EquipmentCatalogs
): Weapon | null {
  const actor = save.actorsById[actorId];
  if (!actor) return null;
  const weaponId = getEquippedWeaponId(actor);
  if (!weaponId) return null;
  const resolved = resolveEquipmentCatalogs(save, catalogs);
  return resolved.weaponsById[weaponId] ?? null;
}

/**
 * Resolves equipped armor definition for an actor
 */
export function getEquippedArmor(
  save: GameSave,
  actorId: string,
  catalogs?: EquipmentCatalogs
): Armor | null {
  const actor = save.actorsById[actorId];
  if (!actor) return null;
  const armorId = getEquippedArmorId(actor);
  if (!armorId) return null;
  const resolved = resolveEquipmentCatalogs(save, catalogs);
  return resolved.armorsById[armorId] ?? null;
}

/**
 * Checks if a shield is equipped in off-hand
 */
export function hasShieldEquipped(save: GameSave, actorId: string, catalogs?: EquipmentCatalogs): boolean {
  const actor = save.actorsById[actorId];
  if (!actor) return false;
  const offHand = actor.equipment?.offHand;
  if (!offHand) return false;
  if (offHand.kind !== "item" && offHand.kind !== "misc") {
    return false;
  }
  const resolved = resolveEquipmentCatalogs(save, catalogs);
  const item = resolved.itemsById[offHand.id];
  if (!item) return false;
  return Boolean(item.shield || item.tags?.includes("shield"));
}

/**
 * Gets the equipped shield item (off-hand), if any
 */
export function getEquippedShield(
  save: GameSave,
  actorId: string,
  catalogs?: EquipmentCatalogs
): ItemDefinition | null {
  const actor = save.actorsById[actorId];
  if (!actor) return null;
  const offHand = actor.equipment?.offHand;
  if (!offHand || (offHand.kind !== "item" && offHand.kind !== "misc")) return null;
  const resolved = resolveEquipmentCatalogs(save, catalogs);
  const item = resolved.itemsById[offHand.id];
  if (!item || (!item.shield && !item.tags?.includes("shield"))) return null;
  return item;
}

/**
 * Gets shield soak bonus from equipped shield (if any)
 */
export function getShieldSoak(save: GameSave, actorId: string, catalogs?: EquipmentCatalogs): number {
  const shield = getEquippedShield(save, actorId, catalogs);
  return shield?.shield?.soak ?? 0;
}

/**
 * Gets the equipped weapon for an actor, or returns unarmed weapon data
 */
export function getActorWeapon(
  save: GameSave,
  actor: Actor
): {
  weapon: Weapon | null;
  weaponId: WeaponId | "unarmed";
  name: string;
} {
  const weaponId = getEquippedWeaponId(actor);
  const weapon = weaponId ? save.weaponsById?.[weaponId] : null;

  if (!weaponId || !weapon) {
    const naturalWeapon = getNaturalWeaponProfileFromActor(actor);
    if (naturalWeapon) {
      return {
        weapon: naturalWeapon,
        weaponId: naturalWeapon.id,
        name: naturalWeapon.name,
      };
    }
    const naturalAbilities = getNaturalAbilityWeapons(actor);
    if (naturalAbilities.length > 0) {
      const firstAbility = naturalAbilities[0];
      return {
        weapon: firstAbility,
        weaponId: firstAbility.id,
        name: firstAbility.name,
      };
    }
    // Unarmed: MELEE with 1d10 + SB
    return {
      weapon: null,
      weaponId: "unarmed",
      name: "Unarmed",
    };
  }

  return {
    weapon,
    weaponId,
    name: weapon.name,
  };
}

/**
 * Gets the equipped armor for an actor, or returns no armor data
 */
export function getActorArmor(
  save: GameSave,
  actor: Actor
): {
  armor: Armor | null;
  armorId: ArmorId | "none";
  name: string;
  soak: number;
} {
  const armorId = getEquippedArmorId(actor);
  const armor = armorId ? save.armorsById?.[armorId] : null;
  const shieldSoak = getShieldSoak(save, actor.id);

  if (!armorId || !armor) {
    return {
      armor: null,
      armorId: "none",
      name: "None",
      soak: shieldSoak,
    };
  }

  return {
    armor,
    armorId,
    name: armor.name,
    soak: armor.soak + shieldSoak,
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
  catalogs?: CharacterCatalogs,
  options?: { tearing?: boolean; extraDice?: number; rerollOnes?: boolean }
): { rawDamage: number; weaponName: string; weaponId: WeaponId | "unarmed" } {
  if (!weaponId || weaponId === "unarmed" || !save.weaponsById?.[weaponId]) {
    // Unarmed: 1d5 + STR bonus (always applies STR bonus for unarmed)
    let bestRoll = 0;
    const strBonus = getCharacteristicBonus(save, attacker.id, "STR");
    for (let i = 0; i < rollsCount; i++) {
      let dieRoll = rng.nextInt(1, 5);
      if (options?.rerollOnes && dieRoll === 1) {
        dieRoll = rng.nextInt(1, 5);
      }
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
  const mightyShotBonus =
    mode === "RANGED" && catalogs ? getRangedDamageBonusFromMightyShot(save, catalogs, attacker.id) : 0;

  // Get talent damage bonuses (Crushing Blow for melee, Deathdealer for both)
  const meleeTalentBonus = mode === "MELEE" && catalogs ? getMeleeDamageBonusFromTalents(save, catalogs, attacker.id) : 0;
  const rangedTalentBonus = mode === "RANGED" && catalogs ? getRangedDamageBonusFromTalents(save, catalogs, attacker.id) : 0;

  const extraDice = Math.max(0, options?.extraDice ?? 0);
  const tearing = options?.tearing ?? false;
  const primitiveRank = getWeaponQualityRank(weapon, "primitive");
  const provenRank = getWeaponQualityRank(weapon, "proven");

  for (let i = 0; i < rollsCount; i++) {
    // Calculate damage based on weapon damage tier
    let dieRoll = 0;
    switch (weapon.damage.tier) {
      case "fixed":
        dieRoll = 0; // No die roll, just add bonus
        break;
      case "half":
        dieRoll = rng.nextInt(1, 5); // 1d5
        break;
      case "single":
        if (tearing) {
          const rolls = [rng.nextInt(1, 10), rng.nextInt(1, 10)];
          rolls.sort((a, b) => a - b);
          dieRoll = rolls[1];
        } else {
          dieRoll = rng.nextInt(1, 10); // 1d10
        }
        break;
      case "double":
        if (tearing) {
          const rolls = [rng.nextInt(1, 10), rng.nextInt(1, 10), rng.nextInt(1, 10)];
          rolls.sort((a, b) => a - b);
          dieRoll = rolls[1] + rolls[2];
        } else {
          dieRoll = rng.nextInt(1, 10) + rng.nextInt(1, 10); // 2d10
        }
        break;
      case "triple":
        if (tearing) {
          const rolls = [rng.nextInt(1, 10), rng.nextInt(1, 10), rng.nextInt(1, 10), rng.nextInt(1, 10)];
          rolls.sort((a, b) => a - b);
          dieRoll = rolls[1] + rolls[2] + rolls[3];
        } else {
          dieRoll = rng.nextInt(1, 10) + rng.nextInt(1, 10) + rng.nextInt(1, 10); // 3d10
        }
        break;
      case "quadfold":
        if (tearing) {
          const rolls = [
            rng.nextInt(1, 10),
            rng.nextInt(1, 10),
            rng.nextInt(1, 10),
            rng.nextInt(1, 10),
            rng.nextInt(1, 10),
          ];
          rolls.sort((a, b) => a - b);
          dieRoll = rolls[1] + rolls[2] + rolls[3] + rolls[4];
        } else {
          dieRoll = rng.nextInt(1, 10) + rng.nextInt(1, 10) + rng.nextInt(1, 10) + rng.nextInt(1, 10); // 4d10
        }
        break;
      case "fivefold":
        if (tearing) {
          const rolls = [
            rng.nextInt(1, 10),
            rng.nextInt(1, 10),
            rng.nextInt(1, 10),
            rng.nextInt(1, 10),
            rng.nextInt(1, 10),
            rng.nextInt(1, 10),
          ];
          rolls.sort((a, b) => a - b);
          dieRoll = rolls[1] + rolls[2] + rolls[3] + rolls[4] + rolls[5];
        } else {
          dieRoll =
            rng.nextInt(1, 10) + rng.nextInt(1, 10) + rng.nextInt(1, 10) + rng.nextInt(1, 10) + rng.nextInt(1, 10); // 5d10
        }
        break;
    }

    if (primitiveRank || provenRank) {
      const minClamp = provenRank ?? Number.NEGATIVE_INFINITY;
      const maxClamp = primitiveRank ?? Number.POSITIVE_INFINITY;
      dieRoll = Math.min(maxClamp, Math.max(minClamp, dieRoll));
    }

    let rollDamage = dieRoll + weapon.damage.add;
    if (extraDice > 0) {
      for (let extra = 0; extra < extraDice; extra++) {
        rollDamage += rng.nextInt(1, 10);
      }
    }

    // MELEE: Always apply STR bonus + melee talent bonuses (Crushing Blow, Deathdealer)
    // RANGED: Never apply STR bonus (only weapon base damage + ranged bonuses)
    if (mode === "MELEE") {
      const strBonus = getCharacteristicBonus(save, attacker.id, "STR", catalogs);
      rollDamage += strBonus;
      rollDamage += meleeTalentBonus; // Crushing Blow (ceil(WSB/2)) + Deathdealer (PER bonus)
    } else if (mode === "RANGED") {
      // RANGED: Add Mighty Shot bonus + ranged talent bonus (Deathdealer)
      rollDamage += mightyShotBonus;
      rollDamage += rangedTalentBonus; // Deathdealer (PER bonus)
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
