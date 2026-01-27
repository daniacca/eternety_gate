import type { GameSave, ActorId, Actor, Weapon, WeaponId, WeaponDamageTier } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getModifierTotal } from "./modifiers";

export type NaturalWeaponProfile = Weapon;

const NATURAL_WEAPON_TRAIT = "trait:natural_weapons";
const DEADLY_NATURAL_WEAPON_TRAIT = "trait:deadly_natural_weapons";
const NATURAL_WEAPON_ID_PREFIX = "weapon:natural:";

export function getNaturalWeaponId(actorId: ActorId): WeaponId {
  return `${NATURAL_WEAPON_ID_PREFIX}${actorId}`;
}

export function isNaturalWeaponId(weaponId: string | null | undefined): boolean {
  return typeof weaponId === "string" && weaponId.startsWith(NATURAL_WEAPON_ID_PREFIX);
}

function hasNaturalWeaponsFlag(save: GameSave, catalogs: CharacterCatalogs | undefined, actor: Actor): boolean {
  if (actor.tags?.includes("natural_weapon")) return true;
  if (actor.traits?.[NATURAL_WEAPON_TRAIT] !== undefined || actor.traits?.[DEADLY_NATURAL_WEAPON_TRAIT] !== undefined) {
    return true;
  }
  if (!catalogs) return false;
  return getModifierTotal(save, catalogs, actor.id, "combat.hasNaturalWeapons" as any) > 0;
}

function hasDeadlyNaturalWeapons(save: GameSave, catalogs: CharacterCatalogs | undefined, actor: Actor): boolean {
  if (actor.traits?.[DEADLY_NATURAL_WEAPON_TRAIT] !== undefined) return true;
  if (!catalogs) return false;
  return getModifierTotal(save, catalogs, actor.id, "combat.deadlyNaturalWeapons" as any) > 0;
}

function resolveNaturalWeaponSize(actor: Actor): number {
  const sizeParams = actor.traits?.["trait:size"];
  return typeof sizeParams === "object" && typeof sizeParams.size === "number" ? sizeParams.size : 4;
}

function tierFromSize(size: number): { tier: WeaponDamageTier; add: number; penetration: number } {
  if (size <= 2) {
    return { tier: "fixed", add: 1, penetration: 0 };
  }
  if (size <= 4) {
    return { tier: "half", add: 0, penetration: 1 };
  }
  if (size === 5) {
    return { tier: "single", add: 0, penetration: 2 };
  }
  if (size <= 7) {
    return { tier: "double", add: 0, penetration: 4 };
  }
  return { tier: "triple", add: 0, penetration: 6 };
}

function buildNaturalWeapon(actor: Actor, weaponId: WeaponId, deadly: boolean): Weapon {
  const size = resolveNaturalWeaponSize(actor);
  const { tier, add, penetration } = tierFromSize(size);
  return {
    id: weaponId,
    name: "Natural Weapons",
    kind: "MELEE",
    damage: {
      tier,
      add,
      bonus: "SB",
    },
    damageType: "rendering",
    penetration,
    handedness: "oneHand",
    qualities: deadly ? [] : [{ id: "primitive", rank: 7 }],
  };
}

export function hasNaturalWeapons(save: GameSave, catalogs: CharacterCatalogs | undefined, actorId: ActorId): boolean {
  const actor = save.actorsById[actorId];
  if (!actor) return false;
  return hasNaturalWeaponsFlag(save, catalogs, actor);
}

/**
 * Gets natural weapon profile based on actor's size trait
 * Default size is 4 (Average) if missing
 */
export function getNaturalWeaponProfile(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): NaturalWeaponProfile | null {
  const actor = save.actorsById[actorId];
  if (!actor) return null;

  if (!hasNaturalWeaponsFlag(save, catalogs, actor)) return null;

  const weaponId = getNaturalWeaponId(actorId);
  const deadly = hasDeadlyNaturalWeapons(save, catalogs, actor);
  return buildNaturalWeapon(actor, weaponId, deadly);
}

export function getNaturalWeaponProfileFromActor(actor: Actor): NaturalWeaponProfile | null {
  if (!actor) return null;
  const hasNatural = actor.tags?.includes("natural_weapon") ||
    actor.traits?.[NATURAL_WEAPON_TRAIT] !== undefined ||
    actor.traits?.[DEADLY_NATURAL_WEAPON_TRAIT] !== undefined;
  if (!hasNatural) return null;
  const deadly = actor.traits?.[DEADLY_NATURAL_WEAPON_TRAIT] !== undefined;
  const weaponId = getNaturalWeaponId(actor.id);
  return buildNaturalWeapon(actor, weaponId, deadly);
}

