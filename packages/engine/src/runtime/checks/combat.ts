import type { CombatAttackCheck, CheckResult, StoryPack, GameSave, Actor, StatOrSkillKey } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { type IRNG } from "../rng";
import { resolveActor } from "./resolve";
import { computeTargetBreakdown } from "./target";
import { evaluateRoll } from "./evaluation";
import { computeCombatModifiersFromConditions } from "../conditions";
import { getEquippedWeaponId } from "../characters/inventory";
import { footprintDistanceBetweenActors } from "../combat/footprint";
import { appendRuntimeLog } from "../combat/narration";
import { loadCharacterCatalogs } from "../../content/loadCatalogs";
import { hasTrait } from "../characters/prerequisites";
import { getUntouchableAuraRadius, getUntouchableWilBonus, isUntouchable } from "../characters/untouchable";
import {
  getCombatMasterPenalty,
  hasMarksmanTalent,
  hasDeadeyeTalent,
  getShieldMasteryParryBonus,
  getFatiguePenaltyReduction,
} from "../characters/talentModifiers";

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
  // Determine attack stat (WS for MELEE, BS for RANGED)
  const attackStatKey: StatOrSkillKey = check.attacker.mode === "MELEE" ? "WS" : "BS";
  const breakdown = computeTargetBreakdown(attacker, attackStatKey, "Challenging", save, storyPack);

  // Apply combat modifiers to target
  let combatModifier = 0;
  const modifierTags: string[] = [];

  // Outnumbering modifier
  if (check.modifiers?.outnumbering !== undefined) {
    if (check.modifiers.outnumbering >= 3) {
      combatModifier += 20;
      modifierTags.push("combat:mod:outnumbering=+20");
    } else if (check.modifiers.outnumbering >= 2) {
      combatModifier += 10;
      modifierTags.push("combat:mod:outnumbering=+10");
    }
  }

  // Check if attacker has Marksman talent (ignore distance penalties for ranged)
  const attackerHasMarksman = catalogs && hasMarksmanTalent(save, catalogs, attacker.id);
  
  // Check if attacker has Deadeye talent (ignore light cover, treat heavy as light)
  const attackerHasDeadeye = catalogs && hasDeadeyeTalent(save, catalogs, attacker.id);

  // Range band modifier (RANGED only)
  // Global rule based on Chebyshev distance:
  // dist >= 9 => EXTREME (-40)
  // dist 6..8 => LONG (-20)
  // dist 4..5 => NORMAL (+0)
  // dist 2..3 => SHORT (+20)
  // dist 0..1 => POINT_BLANK (+30)
  // Marksman talent: ignores all distance penalties (but keeps bonuses)
  if (check.attacker.mode === "RANGED" && check.modifiers?.rangeBand) {
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
  if (check.attacker.mode === "RANGED" && check.modifiers?.cover) {
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
  if (check.attacker.mode === "RANGED" && attackerStance === "aim") {
    combatModifier += 20;
    modifierTags.push("combat:mod:aim=+20");
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
  const isDefenderArmed = defenderWeaponId && defenderWeaponId !== "unarmed";
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
      if (dist <= radius && (appliesToRanged || check.attacker.mode === "MELEE")) {
        combatModifier -= 20;
        modifierTags.push("combat:mod:untouchable=-20");

        if (hasTrait(attacker, "trait:weaver")) {
          const wilBonus = getUntouchableWilBonus(save, defender.id, catalogs);
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
    if (check.attacker.mode === "RANGED") {
      // Ranged attacks against prone target: -10 to hit
      combatModifier -= 10;
      modifierTags.push("combat:mod:prone:ranged=-10");
    } else if (check.attacker.mode === "MELEE") {
      // Melee attacks against prone target: +20 if attacker is not prone, 0 if both prone
      if (!isAttackerProne) {
        combatModifier += 20;
        modifierTags.push("combat:mod:prone:melee=+20");
      }
    }
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

  // Combat Master: defender talent that gives attackers -20 to hit in melee
  if (check.attacker.mode === "MELEE" && catalogs) {
    const combatMasterPenalty = getCombatMasterPenalty(save, catalogs, defender.id);
    if (combatMasterPenalty !== 0) {
      combatModifier += combatMasterPenalty; // Already negative from talent
      modifierTags.push(`combat:mod:combatMaster=${combatMasterPenalty}`);
    }
  }

  const attackTarget = breakdown.target + combatModifier;

  return {
    target: attackTarget,
    tags: modifierTags,
    modifier: combatModifier,
  };
}

export function performCombatAttackCheck(
  check: CombatAttackCheck,
  storyPack: StoryPack | undefined,
  save: GameSave,
  rng: IRNG,
  resolutionId?: string
): { result: CheckResult; save: GameSave } {
  // Resolve actors
  const attacker = resolveActor(check.attacker.actorRef, save, storyPack);
  const defender = resolveActor(check.defender.actorRef, save, storyPack);
  if (!attacker || !defender) return { result: null, save };

  // Load catalogs for talent modifiers
  const catalogs: CharacterCatalogs | undefined =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;

  // Compute attack target using centralized function
  const {
    target: attackTarget,
    tags: modifierTags,
    modifier: combatModifier,
  } = computeAttackTarget(check, attacker, defender, save, storyPack, catalogs);

  // Determine attack stat for tags
  const attackStatKey: StatOrSkillKey = check.attacker.mode === "MELEE" ? "WS" : "BS";

  // Roll attack
  const attackRoll = rng.rollD100();
  const attackResult = evaluateRoll(attackRoll, attackTarget, storyPack, check.id, attacker.id);

  if (!attackResult) return { result: null, save };

  // Build attack tags
  const tags = [...attackResult.tags];

  // Add modifier tags from computeAttackTarget
  tags.push(...modifierTags);

  // Tag for All-Out Attack bonus (if hitBonus is present)
  if (check.modifiers?.hitBonus !== undefined && check.modifiers.hitBonus > 0) {
    tags.push("combat:stance=allOut");
  }

  // Get breakdown for base value calculation
  const breakdown = computeTargetBreakdown(attacker, attackStatKey, "Challenging", save, storyPack);
  const defenderStance = save.runtime.combat?.stancesByActorId?.[defender.id];
  if (defenderStance === "defend") {
    tags.push("combat:defenderStance=defend");
  }

  // Add distance and weapon range tags for ranged attacks
  if (check.attacker.mode === "RANGED") {
    const combat = save.runtime.combat;
    if (combat?.active) {
      // Use footprint-to-footprint distance for ranged attacks
      const dist = footprintDistanceBetweenActors(save, attacker.id, defender.id);
      tags.push(`combat:distance=${dist}`);

      // Add weapon range if available
      const weaponId =
        check.attacker.weaponId ??
        (attacker.equipment?.mainHand?.kind === "weapon" ? attacker.equipment.mainHand.id : null);
      if (weaponId && weaponId !== "unarmed" && save.weaponsById?.[weaponId]?.range) {
        const weaponRange = save.weaponsById[weaponId].range!;
        tags.push(`combat:weaponRange:short=${weaponRange.short}`);
        tags.push(`combat:weaponRange:long=${weaponRange.long}`);
      }
    }
  }

  tags.push(`combat:attackStat=${attackStatKey}`);
  tags.push(`combat:attackTarget=${attackTarget}`);
  tags.push(`combat:attackRoll=${attackRoll}`);
  tags.push(`combat:attackDoS=${attackResult.dos}`);
  tags.push(`combat:attackDoF=${attackResult.dof}`);
  tags.push(`combat:calc:base=${breakdown.baseValue}`);
  tags.push(`combat:calc:mods=${combatModifier}`);
  tags.push(`combat:calc:target=${attackTarget}`);
  tags.push(`combat:defenderId=${defender.id}`);

  // If attack failed, return MISS (with correct DoF)
  if (!attackResult.success) {
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: false,
        dos: 0,
        dof: attackResult.dof,
        critical: attackResult.critical,
        tags,
      },
      save,
    };
  }

  // Attack succeeded - determine defense
  // Check if defender can parry (based on parryDisabledUntilTurnCounterByActorId)
  const combat = save.runtime.combat;
  const turnCounter = combat?.turnCounter ?? 0;
  const disabledUntil = combat?.parryDisabledUntilTurnCounterByActorId?.[defender.id] ?? -1;
  const canParry = turnCounter >= disabledUntil && check.defense.allowParry;
  const canDodge = check.defense.allowDodge;

  // Use skill keys for defense
  const parrySkillKey: StatOrSkillKey = "SKILL:skill:parry";
  const dodgeSkillKey: StatOrSkillKey = "SKILL:skill:dodge";

  let defenseType: "parry" | "dodge" | "none" = "none";
  let defenseSkillKey: StatOrSkillKey | null = null;

  // Get Shield Mastery parry bonus (if defender has talent and shield equipped)
  const shieldMasteryBonus = catalogs ? getShieldMasteryParryBonus(save, catalogs, defender.id) : 0;

  if (check.defense.strategy === "preferParry" && canParry) {
    defenseType = "parry";
    defenseSkillKey = parrySkillKey;
  } else if (check.defense.strategy === "preferDodge" && canDodge) {
    defenseType = "dodge";
    defenseSkillKey = dodgeSkillKey;
  } else if (check.defense.strategy === "autoBest") {
    // Calculate both defense targets and choose the best one
    let parryTarget = -Infinity;
    let dodgeTarget = -Infinity;

    if (canParry) {
      const parryBreakdown = computeTargetBreakdown(defender, parrySkillKey, "Challenging", save, storyPack);
      parryTarget = parryBreakdown.target + shieldMasteryBonus;
    }

    if (canDodge) {
      const dodgeBreakdown = computeTargetBreakdown(defender, dodgeSkillKey, "Challenging", save, storyPack);
      dodgeTarget = dodgeBreakdown.target;
    }

    // Choose the defense with the highest target (best chance to succeed)
    if (canParry && canDodge) {
      if (parryTarget >= dodgeTarget) {
        defenseType = "parry";
        defenseSkillKey = parrySkillKey;
      } else {
        defenseType = "dodge";
        defenseSkillKey = dodgeSkillKey;
      }
    } else if (canParry) {
      defenseType = "parry";
      defenseSkillKey = parrySkillKey;
    } else if (canDodge) {
      defenseType = "dodge";
      defenseSkillKey = dodgeSkillKey;
    }
  }

  tags.push(`combat:defense=${defenseType}`);
  if (!canParry && check.defense.allowParry) {
    tags.push("combat:defense:parryBlocked=1");
  }

  // Initialize updatedSave (will be updated if defense check is logged)
  let updatedSave = save;

  // If no defense, HIT
  if (defenseType === "none" || !defenseSkillKey) {
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: true,
        dos: attackResult.dos,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  }

  // Roll defense using the chosen skill
  const defenseBreakdown = computeTargetBreakdown(defender, defenseSkillKey, "Challenging", save, storyPack);
  // Add Shield Mastery bonus to parry target only
  const parryBonus = defenseType === "parry" ? shieldMasteryBonus : 0;
  const defenseTarget = defenseBreakdown.target + parryBonus;

  const defenseRoll = rng.rollD100();
  const defenseResult = evaluateRoll(defenseRoll, defenseTarget, storyPack, check.id, defender.id);

  // Log defense check if defender belongs to party
  if (defenseResult) {
    const partyIds = new Set(save.party?.actors ?? []);
    const isDefenderPartyMember = partyIds.has(defender.id) || defender.kind === "PC";

    if (isDefenderPartyMember) {
      const defenseCheckResult: CheckResult = {
        checkId: `${check.id}:defense:${defenseType}`,
        actorId: defender.id,
        roll: defenseRoll,
        target: defenseTarget,
        success: defenseResult.success,
        dos: defenseResult.dos,
        dof: defenseResult.dof,
        critical: defenseResult.critical,
        tags: [
          `combat:defenseType=${defenseType}`,
          `combat:defenseSkill=${defenseSkillKey}`,
          `combat:defTarget=${defenseTarget}`,
          `combat:defRoll=${defenseRoll}`,
          `combat:defDoS=${defenseResult.dos}`,
          `combat:defDoF=${defenseResult.dof}`,
          `combat:defCalc:base=${defenseBreakdown.baseValue}`,
          `combat:defCalc:mods=${defenseBreakdown.tempModsSum}`,
          `combat:defCalc:target=${defenseTarget}`,
          ...(parryBonus > 0 ? [`combat:defCalc:shieldMastery=+${parryBonus}`] : []),
        ],
      };
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "check",
        check: defenseCheckResult,
        resolutionId,
      });
    }
  }

  if (!defenseResult) {
    // Defense roll failed somehow, treat as no defense
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: true,
        dos: attackResult.dos,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  }

  // Add defense tags
  tags.push(`combat:defTarget=${defenseTarget}`);
  tags.push(`combat:defRoll=${defenseRoll}`);
  tags.push(`combat:defDoS=${defenseResult.dos}`);
  tags.push(`combat:defSuccess=${defenseResult.success ? 1 : 0}`);
  tags.push(`combat:defCalc:base=${defenseBreakdown.baseValue}`);
  tags.push(`combat:defCalc:mods=${defenseBreakdown.tempModsSum}`);
  tags.push(`combat:defCalc:target=${defenseTarget}`);

  // Determine outcome
  if (!defenseResult.success) {
    // Defense failed - HIT
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: true,
        dos: attackResult.dos,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  }

  // Both attack and defense succeeded - compare DoS
  if (attackResult.dos > defenseResult.dos) {
    // Attacker wins - HIT
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: true,
        dos: attackResult.dos - defenseResult.dos,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  } else {
    // Tie or defender wins - MISS
    const isTie = attackResult.dos === defenseResult.dos;
    if (isTie) {
      tags.push("combat:tie=1");
    }
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: false,
        dos: 0,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  }
}
