import type { Actor, Weapon, WeaponDamageType, WeaponDamageTier, WeaponId } from "../types";

export type NaturalAbilityProfile = {
  name: string;
  kind: "MELEE" | "RANGED";
  damageType: WeaponDamageType;
  damage: {
    tier: WeaponDamageTier;
    add: number;
    bonus?: "SB";
  };
  penetration: number;
  range?: {
    short: number;
    long: number;
  };
  qualities?: Array<{ id: string; rank?: number }>;
  handedness?: "oneHand" | "twoHand";
};

const NATURAL_ABILITY_TRAIT_ID = "trait:natural_ability";
const NATURAL_ABILITY_WEAPON_PREFIX = "weapon:natural_ability:";

type NaturalAbilityTraitParams =
  | NaturalAbilityProfile
  | { profile?: NaturalAbilityProfile }
  | { profiles?: NaturalAbilityProfile[] }
  | { abilities?: NaturalAbilityProfile[] }
  | NaturalAbilityProfile[];

function normalizeProfiles(params: NaturalAbilityTraitParams | undefined): NaturalAbilityProfile[] {
  if (!params) return [];
  if (Array.isArray(params)) return params;
  if ("profile" in params && params.profile) return [params.profile];
  if ("profiles" in params && Array.isArray(params.profiles)) return params.profiles;
  if ("abilities" in params && Array.isArray(params.abilities)) return params.abilities;
  if ((params as NaturalAbilityProfile).name) return [params as NaturalAbilityProfile];
  return [];
}

export function getNaturalAbilityProfiles(actor: Actor): NaturalAbilityProfile[] {
  const params = actor.traits?.[NATURAL_ABILITY_TRAIT_ID] as NaturalAbilityTraitParams | undefined;
  return normalizeProfiles(params).filter((profile) => Boolean(profile?.name));
}

export function getNaturalAbilityWeapons(actor: Actor): Weapon[] {
  const profiles = getNaturalAbilityProfiles(actor);
  return profiles.map((profile, index) => ({
    id: `${NATURAL_ABILITY_WEAPON_PREFIX}${actor.id}:${index}` as WeaponId,
    name: profile.name,
    kind: profile.kind,
    damage: profile.damage,
    damageType: profile.damageType,
    penetration: profile.penetration,
    range: profile.kind === "RANGED" ? profile.range : undefined,
    qualities: profile.qualities,
    handedness: profile.handedness ?? "oneHand",
  }));
}

export function getNaturalAbilityWeaponMap(actor: Actor): Record<WeaponId, Weapon> {
  const weapons = getNaturalAbilityWeapons(actor);
  const map: Record<WeaponId, Weapon> = {};
  for (const weapon of weapons) {
    map[weapon.id] = weapon;
  }
  return map;
}

export function getNaturalAbilityWeaponById(actor: Actor, weaponId: string | null | undefined): Weapon | null {
  if (!weaponId) return null;
  if (!weaponId.startsWith(NATURAL_ABILITY_WEAPON_PREFIX)) return null;
  const weapons = getNaturalAbilityWeapons(actor);
  return weapons.find((weapon) => weapon.id === weaponId) ?? null;
}
