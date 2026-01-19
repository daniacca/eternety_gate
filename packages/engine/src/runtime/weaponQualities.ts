import type { Weapon, WeaponQualityRef } from "./types";
import type { WeaponQuality } from "../content/catalogs";

export type WeaponQualityCatalog = Record<string, WeaponQuality>;

function normalizeQualityRef(entry: WeaponQualityRef | string): WeaponQualityRef {
  if (typeof entry === "string") {
    return { id: entry };
  }
  return { id: entry.id, rank: entry.rank };
}

export function resolveWeaponQualities(
  weapon: Weapon | null | undefined,
  catalog?: WeaponQualityCatalog
): WeaponQualityRef[] {
  if (!weapon?.qualities || weapon.qualities.length === 0) return [];
  return weapon.qualities.map((entry) => {
    const normalized = normalizeQualityRef(entry as WeaponQualityRef | string);
    if (normalized.rank == null && catalog) {
      const def = catalog[normalized.id];
      if (def?.paramsSchema?.rank) {
        return { ...normalized, rank: 1 };
      }
    }
    return normalized;
  });
}

export function getWeaponQuality(
  weapon: Weapon | null | undefined,
  qualityId: string,
  catalog?: WeaponQualityCatalog
): WeaponQualityRef | undefined {
  const qualities = resolveWeaponQualities(weapon, catalog);
  return qualities.find((quality) => quality.id === qualityId);
}

export function hasWeaponQuality(
  weapon: Weapon | null | undefined,
  qualityId: string,
  catalog?: WeaponQualityCatalog
): boolean {
  return Boolean(getWeaponQuality(weapon, qualityId, catalog));
}

export function getWeaponQualityRank(
  weapon: Weapon | null | undefined,
  qualityId: string,
  catalog?: WeaponQualityCatalog
): number | null {
  const quality = getWeaponQuality(weapon, qualityId, catalog);
  if (!quality) return null;
  return quality.rank ?? 1;
}
