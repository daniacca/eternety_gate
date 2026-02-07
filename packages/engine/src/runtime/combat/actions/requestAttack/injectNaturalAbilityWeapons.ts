import type { GameSave } from "../../../types";
import { getNaturalAbilityWeaponMap, getNaturalAbilityWeapons } from "../../../characters/naturalAbilities";

export function injectNaturalAbilityWeapons(attacker: GameSave["actorsById"][string], save: GameSave): GameSave {
  const naturalAbilityWeapons = getNaturalAbilityWeapons(attacker);
  if (naturalAbilityWeapons.length === 0) return save;
  return {
    ...save,
    weaponsById: {
      ...(save.weaponsById || {}),
      ...getNaturalAbilityWeaponMap(attacker),
    },
  };
}
