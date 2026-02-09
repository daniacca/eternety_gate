import type { CombatAttackCheck, StoryPack, GameSave, Actor } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { computeTargetBreakdown } from "../target";
import { getEquippedWeaponId } from "../../characters/inventory";
import { resolveAttackStatKey } from "./resolveAttackStatKey";
import { runHooks } from "../../hooks";
import { buildCombatCheckFacts } from "../../hooks/facts";

/**
 * Centralized function to compute attack target and modifiers
 * Returns: { target: number; tags: string[]; modifier: number }
 */
export function computeAttackTarget(
  check: CombatAttackCheck,
  attacker: Actor,
  defender: Actor,
  save: GameSave,
  storyPack?: StoryPack,
  catalogs?: CharacterCatalogs
): { target: number; tags: string[]; modifier: number } {
  // Determine attack stat (WS for MELEE, BS/WIL for RANGED)
  const attackStatKey = resolveAttackStatKey(check, attacker, save);
  const weaponId = check.attacker.weaponId ?? getEquippedWeaponId(attacker);
  const attackWeapon = weaponId && weaponId !== "unarmed" ? save.weaponsById?.[weaponId] : null;
  const breakdown = computeTargetBreakdown(attacker, attackStatKey, "Challenging", save, storyPack);

  const hookResult = runHooks("pre-check", {
    save,
    storyPack,
    catalogs,
    check,
    attacker,
    defender,
    weapon: attackWeapon,
    facts: buildCombatCheckFacts({ check, attacker, defender, save, storyPack, catalogs }),
  });

  const combatModifier = hookResult.checkTargetMod;
  const modifierTags = hookResult.tags;

  const attackTarget = breakdown.target + combatModifier;

  return {
    target: attackTarget,
    tags: modifierTags,
    modifier: combatModifier,
  };
}
