import type { GameSave, ActorId, Actor } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getCharacteristicBonus } from "./bonuses";
import { getTalentById } from "../../content/loadCatalogs";

/**
 * Calculates max HP for an actor based on:
 * Str Bonus + (2 * Tou Bonus) + Will Bonus + Sound Constitution bonus
 * 
 * @param save - The game save
 * @param actor - The actor
 * @param catalogs - Character catalogs (optional, required for Sound Constitution)
 * @returns The maximum HP value
 */
export function calculateMaxHp(
  save: GameSave,
  actor: Actor,
  catalogs?: CharacterCatalogs
): number {
  const strBonus = getCharacteristicBonus(save, actor.id, "STR", catalogs);
  const touBonus = getCharacteristicBonus(save, actor.id, "TOU", catalogs);
  const wilBonus = getCharacteristicBonus(save, actor.id, "WIL", catalogs);

  const sizeParams = actor.traits?.["trait:size"];
  const size =
    sizeParams && typeof sizeParams === "object" && typeof sizeParams.size === "number" ? sizeParams.size : 4;

  // Base formula depends on size
  const baseHp = size <= 2 ? strBonus + touBonus + wilBonus : strBonus + (2 * touBonus) + wilBonus;
  let sizeMultiplier = 1;
  if (size >= 6 && size <= 8) {
    sizeMultiplier = 2;
  } else if (size >= 9) {
    sizeMultiplier = 4;
  }

  let maxHp = baseHp * sizeMultiplier;

  // Add Sound Constitution bonus: 2 HP per rank
  if (catalogs) {
    const soundConstitutionRank = actor.talents["talent:sound_constitution"] ?? 0;
    if (soundConstitutionRank > 0) {
      const talent = getTalentById(catalogs, "talent:sound_constitution");
      if (talent) {
        for (const grant of talent.grants) {
          if (grant.type === "hpMaxFlat") {
            maxHp += grant.value * soundConstitutionRank;
          }
        }
      }
    }
  }

  return Math.max(1, maxHp); // Ensure at least 1 HP
}

/**
 * Calculates max RF (Fatigue) for an actor based on:
 * 3 * maxHp
 * 
 * @param save - The game save
 * @param actor - The actor
 * @param catalogs - Character catalogs (optional, required for maxHp calculation)
 * @returns The maximum RF value
 */
export function calculateMaxRf(
  save: GameSave,
  actor: Actor,
  catalogs?: CharacterCatalogs
): number {
  const maxHp = calculateMaxHp(save, actor, catalogs);
  return 3 * maxHp;
}

/**
 * Gets current HP for an actor (maxHp - wounds)
 * 
 * @param save - The game save
 * @param actor - The actor
 * @param catalogs - Character catalogs (optional, required for maxHp calculation)
 * @returns The current HP value
 */
export function getCurrentHp(
  save: GameSave,
  actor: Actor,
  catalogs?: CharacterCatalogs
): number {
  const maxHp = calculateMaxHp(save, actor, catalogs);
  const wounds = actor.resources.wounds ?? 0;
  return Math.max(0, maxHp - wounds);
}

