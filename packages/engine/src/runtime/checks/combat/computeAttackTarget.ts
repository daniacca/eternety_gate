import type { CombatAttackCheck, StoryPack, GameSave, Actor } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { computeTargetBreakdown } from "../target";
import { computeCombatModifiersFromConditions } from "../../conditions";
import { getEquippedWeaponId } from "../../characters/inventory";
import { footprintDistanceBetweenActors } from "../../combat/footprint";
import { hasTrait } from "../../characters/prerequisites";
import { getUntouchableAuraRadius, getUntouchableEffectiveWilBonus, isUntouchable } from "../../characters/untouchable";
import { getUntouchableAuraImpact } from "../../combat/untouchableAura";
import { hasNaturalWeapons } from "../../characters/naturalWeapons";
import { hasWeaponQuality } from "../../weaponQualities";
import {
  getCombatMasterPenalty,
  hasMarksmanTalent,
  hasDeadeyeTalent,
  getFatiguePenaltyReduction,
  hasTalentHook,
} from "../../characters/talentModifiers";
import { getUnnaturalSenseRange, isActorBlind } from "./utils";
import { resolveAttackStatKey } from "./resolveAttackStatKey";

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
  const isMagicFueled = hasWeaponQuality(attackWeapon, "magic_fueled");
  const breakdown = computeTargetBreakdown(attacker, attackStatKey, "Challenging", save, storyPack);

  // Apply combat modifiers to target
  let combatModifier = 0;
  const modifierTags: string[] = [];

  // Outnumbering modifier
  const defenderHasMultiFight = catalogs && hasTalentHook(defender, catalogs, "multiFight");
  if (check.modifiers?.outnumbering !== undefined && !defenderHasMultiFight) {
    if (check.modifiers.outnumbering >= 3) {
      combatModifier += 20;
      modifierTags.push("combat:mod:outnumbering=+20");
    } else if (check.modifiers.outnumbering >= 2) {
      combatModifier += 10;
      modifierTags.push("combat:mod:outnumbering=+10");
    }
  } else if (check.modifiers?.outnumbering !== undefined && defenderHasMultiFight) {
    modifierTags.push("combat:mod:outnumbering=+0 (Multi Fight)");
  }

  // Check if attacker has Marksman talent (ignore distance penalties for ranged)
  const attackerHasMarksman = catalogs && hasMarksmanTalent(save, catalogs, attacker.id);

  // Check if attacker has Deadeye talent (ignore light cover, treat heavy as light)
  const attackerHasDeadeye = catalogs && hasDeadeyeTalent(save, catalogs, attacker.id);

  // Magic Fueled: non-weavers suffer -10 penalty to fire
  if (isMagicFueled && !hasTrait(attacker, "trait:weaver", save)) {
    combatModifier -= 10;
    modifierTags.push("combat:mod:magicFueled=nonWeaver:-10");
  }

  // Magic Fueled: untouchable aura penalty (same as spellcasting)
  if (isMagicFueled && catalogs) {
    const auraImpact = getUntouchableAuraImpact(save, catalogs, attacker.id);
    if (auraImpact) {
      combatModifier += auraImpact.penalty;
      modifierTags.push(`combat:mod:magicFueled:aura=${auraImpact.penalty}`);
    }
  }

  const combatDistance = footprintDistanceBetweenActors(save, attacker.id, defender.id);
  const isCloseRangeShot = check.attacker.mode === "RANGED" && check.modifiers?.closeRangeShot && combatDistance <= 1;
  const effectiveMode = isCloseRangeShot ? "MELEE" : check.attacker.mode;
  const attackerSenseRange = getUnnaturalSenseRange(attacker);
  const defenderSenseRange = getUnnaturalSenseRange(defender);
  const attackerBlindActive = isActorBlind(attacker) && (attackerSenseRange <= 0 || combatDistance > attackerSenseRange);
  const defenderBlindActive = isActorBlind(defender) && (defenderSenseRange <= 0 || combatDistance > defenderSenseRange);

  // Range band modifier (RANGED only)
  // Global rule based on Chebyshev distance:
  // dist >= 10 => EXTREME (-40)
  // dist 7..9 => LONG (-20)
  // dist 5..6 => NORMAL (+0)
  // dist 3..4 => SHORT (+20)
  // dist 2 => POINT_BLANK (+30)
  // Marksman talent: ignores all distance penalties (but keeps bonuses)
  if (!isCloseRangeShot && check.attacker.mode === "RANGED" && check.modifiers?.rangeBand) {
    switch (check.modifiers.rangeBand) {
      case "POINT_BLANK":
        combatModifier += 30;
        modifierTags.push("combat:mod:rangeBand:POINT_BLANK=+30");
        break;
      case "SHORT":
        combatModifier += 20;
        modifierTags.push("combat:mod:rangeBand:SHORT=+20");
        break;
      case "NORMAL":
        modifierTags.push("combat:mod:rangeBand:NORMAL=+0");
        break;
      case "LONG":
        if (attackerHasMarksman) {
          modifierTags.push("combat:mod:rangeBand:LONG=+0 (Marksman)");
        } else {
          combatModifier -= 20;
          modifierTags.push("combat:mod:rangeBand:LONG=-20");
        }
        break;
      case "EXTREME":
        if (attackerHasMarksman) {
          modifierTags.push("combat:mod:rangeBand:EXTREME=+0 (Marksman)");
        } else {
          combatModifier -= 40;
          modifierTags.push("combat:mod:rangeBand:EXTREME=-40");
        }
        break;
    }
  }

  // Cover modifier (RANGED only)
  // Deadeye talent: ignore light cover, treat heavy cover as light
  if (effectiveMode === "RANGED" && check.modifiers?.cover) {
    switch (check.modifiers.cover) {
      case "LIGHT":
        if (attackerHasDeadeye) {
          modifierTags.push("combat:mod:cover:LIGHT=+0 (Deadeye)");
        } else {
          combatModifier -= 10;
          modifierTags.push("combat:mod:cover:LIGHT=-10");
        }
        break;
      case "HEAVY":
        if (attackerHasDeadeye) {
          // Treat heavy as light (-10 instead of -20)
          combatModifier -= 10;
          modifierTags.push("combat:mod:cover:HEAVY=-10 (Deadeye)");
        } else {
          combatModifier -= 20;
          modifierTags.push("combat:mod:cover:HEAVY=-20");
        }
        break;
      case "NONE":
        modifierTags.push("combat:mod:cover:NONE=+0");
        break;
    }
  }

  // Called shot modifier: penalty depends on zone (talent unlocks the action)
  // Head: -30, Arms/Body/Legs: -20
  if (check.modifiers?.calledShot) {
    const zone = check.modifiers.calledShotZone || "body";
    const calledShotPenalty = zone === "head" ? -30 : -20;
    combatModifier += calledShotPenalty;
    modifierTags.push(`combat:mod:calledShot=${calledShotPenalty}`);
    modifierTags.push(`combat:mod:calledShotZone=${zone}`);
  }

  // Aim stance modifier: +20 bonus for ranged attacks when aim stance is active
  const attackerStance = save.runtime.combat?.stancesByActorId?.[attacker.id];
  if (effectiveMode === "RANGED" && attackerStance === "aim") {
    const attackerWeaponId = check.attacker.weaponId ?? getEquippedWeaponId(attacker);
    const attackerWeapon =
      attackerWeaponId && attackerWeaponId !== "unarmed" ? save.weaponsById?.[attackerWeaponId] : null;
    const hasInaccurate = hasWeaponQuality(attackerWeapon, "inaccurate");
    const hasAccurate = hasWeaponQuality(attackerWeapon, "accurate");

    if (hasInaccurate) {
      modifierTags.push("combat:mod:aim=+0 (Inaccurate)");
    } else {
      combatModifier += 20;
      modifierTags.push("combat:mod:aim=+20");
      if (hasAccurate) {
        combatModifier += 10;
        modifierTags.push("combat:mod:accurate=+10");
      }
    }
  }

  // Stance modifiers
  const defenderStance = save.runtime.combat?.stancesByActorId?.[defender.id];

  // Hit bonus from modifiers (e.g. All-Out Attack +20)
  if (check.modifiers?.hitBonus !== undefined) {
    combatModifier += check.modifiers.hitBonus;
    modifierTags.push(`combat:mod:hitBonus=${check.modifiers.hitBonus > 0 ? "+" : ""}${check.modifiers.hitBonus}`);
  }

  // Unarmed penalty: -20 to hit if attacker is unarmed and defender has a weapon
  const attackerWeaponId = check.attacker.weaponId ?? getEquippedWeaponId(attacker);
  const isAttackerUnarmed = !attackerWeaponId || attackerWeaponId === "unarmed";
  const defenderWeaponId = getEquippedWeaponId(defender);
  const defenderHasNaturalWeapons = hasNaturalWeapons(save, catalogs, defender.id);
  const isDefenderArmed = (defenderWeaponId && defenderWeaponId !== "unarmed") || defenderHasNaturalWeapons;
  if (isAttackerUnarmed && isDefenderArmed) {
    combatModifier -= 20;
    modifierTags.push("combat:mod:unarmed=-20");
  }

  // Untouchable aura penalty to hit (melee by default, extended radius affects all)
  if (catalogs && isUntouchable(defender)) {
    const radius = getUntouchableAuraRadius(save, catalogs, defender.id);
    if (radius > 0) {
      const dist = footprintDistanceBetweenActors(save, attacker.id, defender.id);
      const appliesToRanged = radius > 1;
      if (dist <= radius && (appliesToRanged || effectiveMode === "MELEE")) {
        combatModifier -= 20;
        modifierTags.push("combat:mod:untouchable=-20");

        if (hasTrait(attacker, "trait:weaver", save)) {
          const wilBonus = getUntouchableEffectiveWilBonus(save, defender.id, catalogs);
          const extraPenalty = -(5 * wilBonus);
          if (extraPenalty !== 0) {
            combatModifier += extraPenalty;
            modifierTags.push(`combat:mod:untouchable:weaver=${extraPenalty}`);
          }
        }
      }
    }
  }

  // Defend: -20 to hit against defender
  if (defenderStance === "defend") {
    combatModifier -= 20;
    modifierTags.push("combat:mod:defenderStance:defend=-20");
  }

  // Prone modifiers
  const isDefenderProne = defender.conditions?.prone !== undefined;
  const isAttackerProne = attacker.conditions?.prone !== undefined;
  if (isDefenderProne) {
    if (effectiveMode === "RANGED") {
      // Ranged attacks against prone target: -10 to hit
      combatModifier -= 10;
      modifierTags.push("combat:mod:prone:ranged=-10");
    } else if (effectiveMode === "MELEE") {
      // Melee attacks against prone target: +20 if attacker is not prone, 0 if both prone
      if (!isAttackerProne) {
        combatModifier += 20;
        modifierTags.push("combat:mod:prone:melee=+20");
      }
    }
  }

  if (attackerBlindActive && effectiveMode === "MELEE") {
    combatModifier -= 30;
    modifierTags.push("combat:mod:blind:melee=-30");
  }
  if (defenderBlindActive && effectiveMode === "MELEE") {
    combatModifier += 30;
    modifierTags.push("combat:mod:blind:target=+30");
  }

  // Apply fatigue penalty from conditions (capped at -30)
  // Relentless talent reduces fatigue penalty tiers
  const fatiguePenaltyReduction = catalogs ? getFatiguePenaltyReduction(save, catalogs, attacker.id) : 0;
  const conditionModifiers = computeCombatModifiersFromConditions(attacker, fatiguePenaltyReduction);
  if (conditionModifiers.toHitPenalty !== undefined) {
    combatModifier -= conditionModifiers.toHitPenalty;
    if (fatiguePenaltyReduction > 0) {
      modifierTags.push(`combat:mod:fatigue=-${conditionModifiers.toHitPenalty} (Relentless)`);
    } else {
      modifierTags.push(`combat:mod:fatigue=-${conditionModifiers.toHitPenalty}`);
    }
  }

  const defenderInvisibilityBonus =
    typeof defender.conditions?.invisibility?.params?.wilBonus === "number"
      ? defender.conditions?.invisibility?.params?.wilBonus
      : 0;
  if (defenderInvisibilityBonus > 0) {
    if (attackerSenseRange <= 0 || combatDistance > attackerSenseRange) {
      const invisPenalty = -5 * defenderInvisibilityBonus;
      combatModifier += invisPenalty;
      modifierTags.push(`combat:mod:invisibleTarget=${invisPenalty}`);
    } else {
      modifierTags.push("combat:mod:invisibleTarget=0 (Unnatural Sense)");
    }
  }

  const attackerInvisibilityBonus =
    typeof attacker.conditions?.invisibility?.params?.wilBonus === "number"
      ? attacker.conditions?.invisibility?.params?.wilBonus
      : 0;
  if (attackerInvisibilityBonus > 0 && effectiveMode === "MELEE") {
    if (defenderSenseRange <= 0 || combatDistance > defenderSenseRange) {
      const invisBonus = 5 * attackerInvisibilityBonus;
      combatModifier += invisBonus;
      modifierTags.push(`combat:mod:invisibleAttacker=+${invisBonus}`);
    } else {
      modifierTags.push("combat:mod:invisibleAttacker=+0 (Unnatural Sense)");
    }
  }

  // Combat Master: defender talent that gives attackers -20 to hit in melee
  if (effectiveMode === "MELEE" && catalogs) {
    const combatMasterPenalty = getCombatMasterPenalty(save, catalogs, defender.id);
    if (combatMasterPenalty !== 0) {
      combatModifier += combatMasterPenalty; // Already negative from talent
      modifierTags.push(`combat:mod:combatMaster=${combatMasterPenalty}`);
    }
  }

  const sunburstWilBonus =
    typeof defender.conditions?.sunburst?.params?.wilBonus === "number"
      ? defender.conditions?.sunburst?.params?.wilBonus
      : 0;
  if (sunburstWilBonus > 0 && effectiveMode === "RANGED") {
    const sunburstPenalty = -10 * sunburstWilBonus;
    combatModifier += sunburstPenalty;
    modifierTags.push(`combat:mod:sunburst=${sunburstPenalty}`);
  }

  const attackTarget = breakdown.target + combatModifier;

  return {
    target: attackTarget,
    tags: modifierTags,
    modifier: combatModifier,
  };
}
