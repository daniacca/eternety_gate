import type { CombatAttackCheck, CheckResult, StoryPack, GameSave, Actor, StatOrSkillKey } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { type IRNG } from "../rng";
import { resolveActor } from "./resolve";
import { computeTargetBreakdown } from "./target";
import { rollD100CheckWithFate, type FateRerollContext, createFateRerollContext } from "./fate";
import { computeCombatModifiersFromConditions } from "../conditions";
import { getEquippedWeaponId } from "../characters/inventory";
import { footprintDistanceBetweenActors } from "../combat/footprint";
import { appendCombatLog, appendRuntimeLog } from "../combat/narration";
import { loadCharacterCatalogs } from "../../content/loadCatalogs";
import { hasTrait } from "../characters/prerequisites";
import { getUntouchableAuraRadius, getUntouchableEffectiveWilBonus, isUntouchable } from "../characters/untouchable";
import { getUntouchableAuraImpact } from "../combat/untouchableAura";
import { getEquippedWeapon, hasShieldEquipped } from "../combat/equipment";
import { hasNaturalWeapons } from "../characters/naturalWeapons";
import { resolveForceFieldBlock } from "../combat/forceField";
import { hasWeaponQuality } from "../weaponQualities";
import { consumeFateProtection } from "../characters/fate";
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
  if (effectiveMode === "MELEE" && catalogs) {
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
  resolutionId?: string,
  fateContext?: FateRerollContext
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

  // Determine attack stat for tags (match computeAttackTarget)
  const attackStatKey = resolveAttackStatKey(check, attacker, save);

  const isCloseRangeShot = check.attacker.mode === "RANGED" && check.modifiers?.closeRangeShot === true;

  // Roll attack
  const attackResult = rollD100CheckWithFate(check.id, attacker.id, attackTarget, storyPack, save, rng, fateContext);
  const attackRoll = attackResult?.roll ?? 0;

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
      if (weaponId && weaponId !== "unarmed" && save.weaponsById?.[weaponId]?.range !== undefined) {
        const weaponRange = save.weaponsById[weaponId].range!;
        tags.push(`combat:weaponRange=${weaponRange}`);
      }
    }
  }

  tags.push(`combat:attackStat=${attackStatKey}`);
  tags.push(`combat:attackTarget=${attackTarget}`);
  tags.push(`combat:attackRoll=${attackRoll}`);
  if (attackResult?.tags?.some((tag) => tag.startsWith("fate:"))) {
    tags.push(...attackResult.tags.filter((tag) => tag.startsWith("fate:")));
  }
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

  // Force Field: block attack before any evasion roll
  const forceFieldResult = resolveForceFieldBlock(save, defender, rng, turnCounter, catalogs);
  if (forceFieldResult.blocked) {
    const defenderName = defender.name || defender.id;
    const overloadText = forceFieldResult.overloaded
      ? ` Un lampo accecante esplode, scariche eldritiche avvolgono l'aria e il bagliore si spegne per ${
          forceFieldResult.overloadDuration ?? 0
        } turni.`
      : "";
    const fatigueText = forceFieldResult.fatigue ? ` (${forceFieldResult.fatigue} Fatigue)` : "";
    const blockLog = `${defenderName}: il Campo di Forza si illumina e annulla l'attacco.${overloadText}${fatigueText}`;
    let updatedSaveForLog = forceFieldResult.save;
    updatedSaveForLog = appendCombatLog(updatedSaveForLog, blockLog);
    const forceFieldTags = [
      "combat:blocked=forceField",
      ...(forceFieldResult.roll !== undefined ? [`combat:forceField:roll=${forceFieldResult.roll}`] : []),
      ...(forceFieldResult.protection !== undefined
        ? [`combat:forceField:protection=${forceFieldResult.protection}`]
        : []),
      ...(forceFieldResult.overload !== undefined ? [`combat:forceField:overload=${forceFieldResult.overload}`] : []),
      ...(forceFieldResult.overloaded ? ["combat:forceField:overloaded=1"] : []),
      ...(forceFieldResult.overloadDuration !== undefined
        ? [`combat:forceField:down=${forceFieldResult.overloadDuration}`]
        : []),
      ...(forceFieldResult.fatigue !== undefined ? [`combat:forceField:fatigue=${forceFieldResult.fatigue}`] : []),
    ];
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
        tags: [...tags, ...forceFieldTags],
      },
      save: updatedSaveForLog,
    };
  }

  const disabledUntil = combat?.parryDisabledUntilTurnCounterByActorId?.[defender.id] ?? -1;
  const defenderWeapon = getEquippedWeapon(save, defender.id);
  const parryWeapon = defenderWeapon?.kind === "MELEE" ? defenderWeapon : null;
  const hasMeleeWeapon = defenderWeapon?.kind === "MELEE";
  const hasShield = hasShieldEquipped(save, defender.id);
  const attackerWeaponId = check.attacker.weaponId ?? getEquippedWeaponId(attacker);
  const attackerWeapon =
    attackerWeaponId && attackerWeaponId !== "unarmed" ? save.weaponsById?.[attackerWeaponId] : null;
  const attackHasFlexible = hasWeaponQuality(attackerWeapon, "flexible");
  const parryWeaponUnwieldy = hasWeaponQuality(parryWeapon, "unwieldy");
  const parryBlockedByUnwieldy = parryWeaponUnwieldy && !hasShield;
  const canParry =
    turnCounter >= disabledUntil &&
    check.defense.allowParry &&
    check.attacker.mode === "MELEE" &&
    (hasMeleeWeapon || hasShield) &&
    !attackHasFlexible &&
    !parryBlockedByUnwieldy;
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
      const dodgeDifficulty =
        check.attacker.mode === "RANGED" && !isCloseRangeShot
          ? check.modifiers?.rangeBand === "POINT_BLANK"
            ? "Very Hard"
            : check.modifiers?.rangeBand === "SHORT"
            ? "Hard"
            : check.modifiers?.rangeBand === "NORMAL"
            ? "Difficult"
            : "Challenging"
          : "Challenging";
      const dodgeBreakdown = computeTargetBreakdown(defender, dodgeSkillKey, dodgeDifficulty, save, storyPack);
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

  // Fallback: if preferred defense isn't available, use the other if allowed.
  if (defenseType === "none") {
    if (canDodge) {
      defenseType = "dodge";
      defenseSkillKey = dodgeSkillKey;
    } else if (canParry) {
      defenseType = "parry";
      defenseSkillKey = parrySkillKey;
    }
  }

  tags.push(`combat:defense=${defenseType}`);
  if (!canParry && check.defense.allowParry) {
    tags.push("combat:defense:parryBlocked=1");
  }
  if (attackHasFlexible) {
    tags.push("combat:defense:parryBlocked=flexible");
  }
  if (parryBlockedByUnwieldy) {
    tags.push("combat:defense:parryBlocked=unwieldy");
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
  const dodgeDifficulty =
    defenseType === "dodge" && check.attacker.mode === "RANGED" && !isCloseRangeShot
      ? check.modifiers?.rangeBand === "POINT_BLANK"
        ? "Very Hard"
        : check.modifiers?.rangeBand === "SHORT"
        ? "Hard"
        : check.modifiers?.rangeBand === "NORMAL"
        ? "Difficult"
        : "Challenging"
      : "Challenging";
  const defenseBreakdown = computeTargetBreakdown(defender, defenseSkillKey, dodgeDifficulty, save, storyPack);
  // Add parry bonuses to parry target only
  const parryQualityBonus =
    defenseType === "parry"
      ? (hasWeaponQuality(parryWeapon, "balanced") ? 10 : 0) + (hasWeaponQuality(parryWeapon, "unbalanced") ? -10 : 0)
      : 0;
  const parryBonus = defenseType === "parry" ? shieldMasteryBonus + parryQualityBonus : 0;
  const defenseTarget = defenseBreakdown.target + parryBonus;

  const defenseFateContext = createFateRerollContext();
  const defenseResult = rollD100CheckWithFate(
    check.id,
    defender.id,
    defenseTarget,
    storyPack,
    save,
    rng,
    defenseFateContext
  );
  const defenseRoll = defenseResult?.roll ?? 0;

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
          ...(shieldMasteryBonus > 0 ? [`combat:defCalc:shieldMastery=+${shieldMasteryBonus}`] : []),
          ...(parryQualityBonus !== 0 ? [`combat:defCalc:weaponQuality=${parryQualityBonus}`] : []),
          ...defenseResult.tags.filter((tag) => tag.startsWith("fate:")),
        ],
      };
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "check",
        check: defenseCheckResult,
        resolutionId,
      });
    }
  }

  if (defenseFateContext.used && defenseFateContext.actorId) {
    updatedSave = consumeFateProtection(updatedSave, defenseFateContext.actorId).save;
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

    // Magic Field / Force: parry may destroy attacking weapon
    if (defenseType === "parry" && defenseResult.success) {
      const parryHasMagicField = hasWeaponQuality(parryWeapon, "magic_field") || hasWeaponQuality(parryWeapon, "force");
      if (parryHasMagicField) {
        const attackerHasNaturalWeapons = hasNaturalWeapons(save, catalogs, attacker.id);
        const attackerWeaponIdForDestruction = attackerWeaponId ?? getEquippedWeaponId(attacker);
        const attackerWeaponForDestruction =
          attackerWeaponIdForDestruction && attackerWeaponIdForDestruction !== "unarmed"
            ? save.weaponsById?.[attackerWeaponIdForDestruction]
            : null;
        const attackerHasMagicField =
          hasWeaponQuality(attackerWeaponForDestruction, "magic_field") || hasWeaponQuality(attackerWeaponForDestruction, "force");

        if (!attackerHasNaturalWeapons && !attackerHasMagicField && attackerWeaponForDestruction) {
          const destructionRoll = rng.rollD100();
          const shouldDestroy = destructionRoll <= 50;

          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "system",
            message: shouldDestroy
              ? `Magic Field: ${attacker.id} weapon destroyed (roll ${destructionRoll})`
              : `Magic Field: ${attacker.id} weapon survives (roll ${destructionRoll})`,
            turnCounter: save.runtime.combat?.turnCounter ?? 0,
            resolutionId,
            tags: [
              "weapon:magicField",
              `roll=${destructionRoll}`,
              `destroyed=${shouldDestroy ? 1 : 0}`,
              `weaponId=${attackerWeaponIdForDestruction}`,
            ],
          });

          if (shouldDestroy) {
            const attackerToUpdate = updatedSave.actorsById[attacker.id];
            if (attackerToUpdate?.equipment) {
              const updatedEquipment = { ...attackerToUpdate.equipment };
              if (updatedEquipment.mainHand?.kind === "weapon" && updatedEquipment.mainHand.id === attackerWeaponIdForDestruction) {
                updatedEquipment.mainHand = null;
              }
              if (updatedEquipment.offHand?.kind === "weapon" && updatedEquipment.offHand.id === attackerWeaponIdForDestruction) {
                updatedEquipment.offHand = null;
              }
              updatedSave = {
                ...updatedSave,
                actorsById: {
                  ...updatedSave.actorsById,
                  [attacker.id]: {
                    ...attackerToUpdate,
                    equipment: updatedEquipment,
                  },
                },
              };
            }
          }
        }
      }
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

/**
 * Resolves the attack stat key based on the check and attacker.
 * Rules:
 * - If the check is a melee attack, return "WS"
 * - If the check is a ranged attack and the weapon is magic fueled, return "WIL"
 * - In all other cases (so, ranged attack and not magic fueled), return "BS"
 * @param check - The combat attack check
 * @param attacker - The attacker actor
 * @param save - The game save
 * @returns The attack stat key
 */
function resolveAttackStatKey(check: CombatAttackCheck, attacker: Actor, save: GameSave): StatOrSkillKey {
  if (check.attacker.mode === "MELEE") {
    return "WS";
  }
  const weaponId = check.attacker.weaponId ?? getEquippedWeaponId(attacker);
  const attackWeapon = weaponId && weaponId !== "unarmed" ? save.weaponsById?.[weaponId] : null;
  const isMagicFueled = hasWeaponQuality(attackWeapon, "magic_fueled");
  return isMagicFueled ? "WIL" : "BS";
}
