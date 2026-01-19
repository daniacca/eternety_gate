import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getTalentById, getTraitById } from "../../content/loadCatalogs";
import { resolveGrantValueRef } from "./grants";
import { getUntouchableEffectiveWilBonus } from "./untouchable";

export type ModifierKey =
  | `magic.${string}`
  | `combat.${string}`
  | `movement.${string}`
  | `skill.${string}.${string}`
  | `stat.${string}.${string}`
  | `env.${string}`
  | `aura.${string}`;

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

    // Special handling for trait:unnatural_characteristic which has an array of characteristics
    if (traitId === "trait:unnatural_characteristic") {
      const characteristics = params?.characteristics;
      if (!Array.isArray(characteristics)) continue;

      // Iterate over each characteristic in the array
      for (const characteristic of characteristics) {
        if (!characteristic || typeof characteristic !== "object") continue;
        const stat = characteristic.stat;
        const bonusX = characteristic.bonusX;

        if (!stat || typeof bonusX !== "number") continue;

        // Apply grants for this characteristic
        for (const grant of trait.grants) {
          if (grant.type === "modifier") {
            let grantKey = grant.key;
            let grantValue = grant.value;

            // Handle dynamic keys like "stat.<stat>.bonusAdd"
            if (grantKey.includes("<stat>")) {
              grantKey = grantKey.replace("<stat>", stat);
            }

            // Handle value references (e.g., "bonusX")
            if (grant.valueRef) {
              // For unnatural_characteristic, valueRef is "bonusX" which comes from the characteristic object
              grantValue = typeof bonusX === "number" ? bonusX : grant.value;
            }

            // Skip computed testAdd for unnatural characteristic when computing base (to avoid recursion)
            if (skipDerivedRules && grantKey.includes("testAdd")) {
              continue;
            }

            if (grantKey === key) {
              total += grantValue;
            }
          }
        }
      }
    } else {
      // Standard trait processing for other traits
      for (const grant of trait.grants) {
        if (grant.type === "modifier") {
          let grantKey = grant.key;
          let grantValue = grant.value;

          // Handle value references (e.g., "armor", "size.toHitMod")
          if (grant.valueRef) {
            grantValue = resolveGrantValueRef(catalogs, actorId, save, traitId, grant.valueRef);
          }

          if (grantKey === key) {
            total += grantValue;
          }
        }
      }
    }
  }

  // Derived Untouchable modifiers (based on WIL bonus)
  if (actor.traits["trait:untouchable"] !== undefined) {
    if (key === "magic.resistance") {
      const wilBonus = getUntouchableEffectiveWilBonus(save, actorId, catalogs);
      total += wilBonus;
    } else if (key === "skill.charm.mod" || key === "skill.intimidate.mod") {
      const wilBonus = getUntouchableEffectiveWilBonus(save, actorId, catalogs);
      total += -(5 * wilBonus);
    } else if (key === "aura.untouchable.wilBonus") {
      const wilBonus = getUntouchableEffectiveWilBonus(save, actorId, catalogs);
      total += wilBonus;
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

  // Check conditions for modifiers
  if (actor.conditions) {
    // force_shield: provides NaturalArmor based on stacks (default 1 stack = +1 armor per overcast)
    if (key === "combat.naturalArmor" && actor.conditions.force_shield) {
      const stacks = actor.conditions.force_shield.stacks ?? 1;
      total += stacks; // Each stack = +1 NaturalArmor
    }

    // Note: steel_body and warp_speed now add characteristics to trait:unnatural_characteristic
    // instead of directly modifying bonusAdd here. This allows them to stack with natural traits.
  }

  // TODO: Check equipment
  const equippedItems = [
    actor.equipment?.mainHand,
    actor.equipment?.offHand,
    actor.equipment?.armor,
    actor.equipment?.helmet,
    actor.equipment?.boots,
    actor.equipment?.cloak,
    actor.equipment?.necklace,
    actor.equipment?.ring1,
    actor.equipment?.ring2,
  ];

  for (const itemRef of equippedItems) {
    if (!itemRef) continue;
    if (itemRef.kind === "item" || itemRef.kind === "misc") {
      const item = save.itemsById?.[itemRef.id];
      if (!item || !item.grants) continue;
      for (const grant of item.grants) {
        if (grant.type === "modifier" && grant.key === key) {
          total += grant.value;
        }
      }
      continue;
    }
    if (itemRef.kind === "weapon") {
      const weapon = save.weaponsById?.[itemRef.id];
      if (!weapon || !weapon.grants) continue;
      for (const grant of weapon.grants) {
        if (grant.type === "modifier" && grant.key === key) {
          total += grant.value;
        }
      }
      continue;
    }
    if (itemRef.kind === "armor") {
      const armor = save.armorsById?.[itemRef.id];
      if (!armor || !armor.grants) continue;
      for (const grant of armor.grants) {
        if (grant.type === "modifier" && grant.key === key) {
          total += grant.value;
        }
      }
    }
  }

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
