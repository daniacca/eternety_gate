import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getTalentById, getTraitById } from "../../content/loadCatalogs";
import { resolveGrantValueRef } from "./grants";

export type ModifierKey =
  | `magic.${string}`
  | `combat.${string}`
  | `movement.${string}`
  | `skill.${string}.${string}`
  | `stat.${string}.${string}`
  | `env.${string}`;

/**
 * Gets base modifier value without applying derived rules (to avoid recursion)
 * This is used internally to compute base totals before applying derived calculations
 */
function getModifierTotalBase(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  key: ModifierKey | string,
  skipDerivedRules: boolean = false
): number {
  const actor = save.actorsById[actorId];
  if (!actor) return 0;

  let total = 0;

  // Check talents
  for (const [talentId, rank] of Object.entries(actor.talents)) {
    if (rank < 1) continue;
    const talent = getTalentById(catalogs, talentId);
    if (!talent) continue;

    for (const grant of talent.grants) {
      if (grant.type === "modifier" && grant.key === key) {
        total += grant.value * rank; // Multiply by rank for talents that stack
      }
    }
  }

  // Check traits
  for (const [traitId, params] of Object.entries(actor.traits)) {
    const trait = getTraitById(catalogs, traitId);
    if (!trait) continue;

    for (const grant of trait.grants) {
      if (grant.type === "modifier") {
        let grantKey = grant.key;
        let grantValue = grant.value;

        // Handle dynamic keys like "stat.<stat>.bonusAdd"
        if (grantKey.includes("<stat>") && traitId === "trait:unnatural_characteristic") {
          const stat = params?.stat;
          if (stat) {
            grantKey = grantKey.replace("<stat>", stat);
          }
        }

        // Handle value references (e.g., "armor", "size.toHitMod")
        if (grant.valueRef) {
          grantValue = resolveGrantValueRef(catalogs, actorId, save, traitId, grant.valueRef);
        }

        // Skip computed testAdd for unnatural characteristic when computing base (to avoid recursion)
        if (skipDerivedRules && grantKey.includes("testAdd") && traitId === "trait:unnatural_characteristic") {
          continue;
        }

        if (grantKey === key) {
          total += grantValue;
        }
      }
    }
  }

  // Handle size trait modifiers (computed from size param)
  if (
    key.startsWith("combat.toHitAgainstSelf") ||
    key.startsWith("skill.stealth.mod") ||
    key.startsWith("movement.baseMod")
  ) {
    const sizeParams = actor.traits["trait:size"];
    if (sizeParams && typeof sizeParams === "object" && typeof sizeParams.size === "number") {
      const size = sizeParams.size;
      const sizeMods = getSizeModifiers(size);
      if (key === "combat.toHitAgainstSelf") {
        total += sizeMods.toHitMod;
      } else if (key === "skill.stealth.mod") {
        total += sizeMods.stealthMod;
      } else if (key === "movement.baseMod") {
        total += sizeMods.moveMod;
      }
    }
  }

  // TODO: Check conditions
  // TODO: Check equipment

  return total;
}

/**
 * Gets total modifier value for a given key from all sources (traits, talents, conditions, equipment)
 * Applies derived rules (e.g., testAdd from bonusAdd for unnatural characteristics)
 */
export function getModifierTotal(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  key: ModifierKey | string
): number {
  // Get base modifiers (explicit grants)
  let total = getModifierTotalBase(save, catalogs, actorId, key, false);

  // Apply derived rules: testAdd from bonusAdd for unnatural characteristics
  // Rule: floor(totalBonusAdd / 2) * 10
  // Detect keys matching /^stat\.(\w+)\.testAdd$/
  const testAddMatch = typeof key === "string" ? key.match(/^stat\.(\w+)\.testAdd$/) : null;
  if (testAddMatch) {
    const statKey = testAddMatch[1];
    const bonusAddKey = `stat.${statKey}.bonusAdd` as ModifierKey | string;

    // Compute unnaturalBonusAdd = total for stat.<STAT>.bonusAdd WITHOUT recursion loops
    const unnaturalBonusAdd = getModifierTotalBase(save, catalogs, actorId, bonusAddKey, true);

    // Return base + Math.floor(unnaturalBonusAdd/2)*10
    const derivedTestAdd = Math.floor(unnaturalBonusAdd / 2) * 10;
    total += derivedTestAdd;
  }

  return total;
}

/**
 * Gets size-based modifiers from size value (1-10)
 */
function getSizeModifiers(size: number): { toHitMod: number; stealthMod: number; moveMod: number } {
  const sizeTable: Record<number, { toHitMod: number; stealthMod: number; moveMod: number }> = {
    1: { toHitMod: -30, stealthMod: 30, moveMod: -3 }, // Miniscule
    2: { toHitMod: -20, stealthMod: 20, moveMod: -2 }, // Puny
    3: { toHitMod: -10, stealthMod: 10, moveMod: -1 }, // Scrawny
    4: { toHitMod: 0, stealthMod: 0, moveMod: 0 }, // Average
    5: { toHitMod: 10, stealthMod: -10, moveMod: 1 }, // Hulking
    6: { toHitMod: 20, stealthMod: -20, moveMod: 2 }, // Enormous
    7: { toHitMod: 30, stealthMod: -30, moveMod: 3 }, // Massive
    8: { toHitMod: 40, stealthMod: -40, moveMod: 4 }, // Immense
    9: { toHitMod: 50, stealthMod: -50, moveMod: 5 }, // Monumental
    10: { toHitMod: 60, stealthMod: -60, moveMod: 6 }, // Titanic
  };

  return sizeTable[size] || sizeTable[4];
}
