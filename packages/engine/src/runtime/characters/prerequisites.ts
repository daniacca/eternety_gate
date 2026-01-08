import type { GameSave, Actor } from "../types";
import type { CharacterCatalogs, Prerequisite } from "../../content/catalogs";
import { getCharacteristicValue } from "./bonuses";

/**
 * Evaluates prerequisites for a talent
 */
export function evaluatePrerequisites(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actor: Actor,
  prerequisites: Prerequisite[]
): { valid: boolean; reason?: string } {
  for (const prereq of prerequisites) {
    if (prereq.type === "statAtLeast") {
      const statValue = getCharacteristicValue(actor.id, prereq.stat, save);
      if (statValue < prereq.value) {
        return {
          valid: false,
          reason: `Requires ${prereq.stat} >= ${prereq.value}, but has ${statValue}`,
        };
      }
    } else if (prereq.type === "hasTalent") {
      const talentRank = actor.talents[prereq.talentId] ?? 0;
      if (talentRank < 1) {
        return {
          valid: false,
          reason: `Requires talent ${prereq.talentId}`,
        };
      }
    } else if (prereq.type === "hasTrait") {
      const hasTrait = actor.traits[prereq.traitId] !== undefined;
      if (!hasTrait) {
        return {
          valid: false,
          reason: `Requires trait ${prereq.traitId}`,
        };
      }
    }
  }
  return { valid: true };
}

/**
 * Checks if actor has a trait
 */
export function hasTrait(actor: Actor, traitId: string): boolean {
  return actor.traits[traitId] !== undefined;
}

/**
 * Checks if actor has a talent with at least minRank
 */
export function hasTalentRank(actor: Actor, talentId: string, minRank: number = 1): boolean {
  const rank = actor.talents[talentId] ?? 0;
  return rank >= minRank;
}

/**
 * Checks if actor has a stat at least at value
 */
export function statAtLeast(save: GameSave, actor: Actor, statKey: string, value: number): boolean {
  const statValue = getCharacteristicValue(actor.id, statKey as any, save);
  return statValue >= value;
}

