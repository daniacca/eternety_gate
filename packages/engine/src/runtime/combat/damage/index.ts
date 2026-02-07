import type { GameSave, CombatAttackCheck, CheckResult, Effect, StoryPack, WeaponId, Actor } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import type { IRNG } from "../../rng";
import { resolveActor } from "../../checks";
import { appendRuntimeLog } from "../narration";
import { getEquippedWeaponId } from "../../characters/inventory";
import { applyDamageToActor } from "../criticalDamage";
import { getWeaponQuality } from "../../weaponQualities";
import { hasTalentHook } from "../../characters/talentModifiers";
import { hasCondition } from "../../conditions";
import { resolveDamageRollOutcome } from "./resolveDamageRollOutcome";
import { computeDamageAfterReductions } from "./computeDamageAfterReductions";
import { finalizeDamageApplication } from "./finalizeDamageApplication";
import { applyWeaponOnHitEffects } from "./applyWeaponOnHitEffects";
import { applyCalledShotEffects } from "./applyCalledShotEffects";
import { applyFireShieldBacklash } from "./applyFireShieldBacklash";

function getDamageRollMode(attacker: Actor): "best" | "worst" | "normal" {
  const hasPrecognition = hasCondition(attacker, "precognition");
  const hasMisfortune = hasCondition(attacker, "misfortune");
  if (hasPrecognition && !hasMisfortune) return "best";
  if (hasMisfortune && !hasPrecognition) return "worst";
  return "normal";
}

/**
 * Applies combat damage when a combatAttack check hits
 * This is the single source of truth for damage application
 */
export function applyCombatDamageIfHit(
  check: CombatAttackCheck,
  result: CheckResult,
  save: GameSave,
  rng: IRNG,
  storyPack?: StoryPack,
  resolutionId?: string,
  catalogs?: CharacterCatalogs,
  isMagicalSource: boolean = false,
  damageOptions?: { bonusDamage?: number; bonusPenetration?: number },
): {
  save: GameSave;
  didApplyDamage: boolean;
  targetKo: boolean;
  finalDamage?: number;
  effects?: Effect[];
  actorDied?: boolean;
} {
  if (!result || !result.success) {
    return { save, didApplyDamage: false, targetKo: false };
  }

  const attacker = resolveActor(check.attacker.actorRef, save);
  const defender = resolveActor(check.defender.actorRef, save);

  if (!attacker || !defender) {
    // Attacker or defender not found, skip damage application
    return { save, didApplyDamage: false, targetKo: false };
  }

  let updatedSave: GameSave = save;

  // Get weapon ID from check or actor equipment
  const weaponId = check.attacker.weaponId ?? getEquippedWeaponId(attacker);
  const mode = check.attacker.mode; // MELEE or RANGED

  // Check if weapon is melee-capable for the current mode
  const weapon = weaponId && weaponId !== "unarmed" ? save.weaponsById?.[weaponId] : null;
  const isUnarmed = !weaponId || weaponId === "unarmed" || !weapon;

  // Fallback: if MELEE attack with RANGED weapon, treat as improvised
  let finalWeaponId: WeaponId | "unarmed" | "improvised" = isUnarmed ? "unarmed" : weaponId;
  let useFallbackWeapon = false;
  if (mode === "MELEE" && weapon && weapon.kind === "RANGED") {
    // Using ranged weapon in melee: fallback to improvised
    useFallbackWeapon = true;
    finalWeaponId = "improvised";
  }

  // Righteous Fury: check for critical success
  const isCriticalSuccess = result.critical === "autoSuccess" || result.critical === "epicSuccess";
  let rollsCount = 1;
  if (isCriticalSuccess && !isUnarmed && !useFallbackWeapon) {
    const weaponForFury = save.weaponsById?.[finalWeaponId];
    // Base rolls = 2 for all weapons
    rollsCount = 2;
    if (weaponForFury) {
      const vengefulQuality = getWeaponQuality(weaponForFury, "vengeful");
      if (vengefulQuality) {
        const vengefulRank = vengefulQuality.rank ?? 3;
        if (vengefulRank > 2) {
          rollsCount = vengefulRank;
        }
      } else if (weaponForFury.tags) {
        const vengefulTag = weaponForFury.tags.find((tag) => tag.startsWith("vengeful"));
        if (vengefulTag) {
          const match = vengefulTag.match(/vengeful:(\d+)/);
          const vengefulValue = match ? parseInt(match[1], 10) : 3;
          if (vengefulValue > 2) {
            rollsCount = vengefulValue;
          }
        }
      }
    }
  }

  const hasUnarmedSpecialist = catalogs ? hasTalentHook(attacker, catalogs, "unarmedSpecialist") : false;

  const rollMode = getDamageRollMode(attacker);
  const rollOutcome = resolveDamageRollOutcome({
    save,
    updatedSave,
    attacker,
    weaponId,
    mode,
    rollsCount,
    result,
    rng,
    catalogs,
    resolutionId,
    isUnarmed,
    useFallbackWeapon,
    hasUnarmedSpecialist,
    rollMode,
  });
  updatedSave = rollOutcome.updatedSave;
  let { rawDamage, calculatedWeaponId, damageRolls, damageFormula } = rollOutcome.outcome;
  const fateDamageRerollUsed = rollOutcome.fateDamageRerollUsed;
  const fateDamageRerollFrom = rollOutcome.fateDamageRerollFrom;

  const reductionResult = computeDamageAfterReductions({
    save,
    updatedSave,
    attacker,
    defender,
    check,
    rawDamage,
    damageFormula,
    calculatedWeaponId,
    useFallbackWeapon,
    isUnarmed,
    resultDos: result.dos,
    mode,
    damageOptions,
    rng,
    catalogs,
    isMagicalSource,
    resolutionId,
  });
  updatedSave = reductionResult.updatedSave;
  rawDamage = reductionResult.rawDamage;
  damageFormula = reductionResult.damageFormula;
  const effectiveSoak = reductionResult.effectiveSoak;
  const touBonus = reductionResult.touBonus;
  const finalDamage = reductionResult.finalDamage;
  const isNaturalWeaponAttack = reductionResult.isNaturalWeaponAttack;
  const armorId = reductionResult.armorId;

  // Build reduction formula for display
  const reductionFormula = `${rawDamage} (Raw) - ${touBonus} (TOU) - ${effectiveSoak} (Soak)`;

  // Combine raw damage formula with reduction formula
  const fullFormula = `${damageFormula} | ${reductionFormula}`;

  const damageResult = applyDamageToActor(defender, finalDamage, updatedSave, rng, storyPack, catalogs);
  const updatedDefender = damageResult.updatedActor;

  const postDamage = finalizeDamageApplication({
    save,
    updatedSave,
    attacker,
    defender,
    updatedDefender,
    damageResult,
    rawDamage,
    effectiveSoak,
    touBonus,
    finalDamage,
    calculatedWeaponId,
    armorId,
    isCriticalSuccess,
    rollsCount,
    isUnarmed,
    useFallbackWeapon,
    rollMode,
    fateDamageRerollUsed,
    fateDamageRerollFrom,
    resolutionId,
    rng,
    storyPack,
    catalogs,
  });

  if (postDamage.earlyReturn) {
    return {
      save: postDamage.save,
      didApplyDamage: false,
      targetKo: false,
      finalDamage: 0,
    };
  }

  updatedSave = postDamage.save;
  const emittedEffects: Effect[] = [...postDamage.effects];
  let actorDied = postDamage.actorDied ?? false;
  const didApplyDamage = postDamage.didApplyDamage;
  const maxHp = postDamage.maxHp;

  // Weapon qualities: on-hit effects (only if final damage >= 1)
  const weaponForHitEffects =
    calculatedWeaponId !== "unarmed" && !useFallbackWeapon ? save.weaponsById?.[calculatedWeaponId] : null;
  const onHitResult = applyWeaponOnHitEffects({
    save: updatedSave,
    attacker,
    defender,
    weaponForHitEffects,
    isUnarmed,
    isNaturalWeaponAttack,
    didApplyDamage,
    resultDos: result.dos,
    rng,
    storyPack,
    catalogs,
    resolutionId,
  });
  updatedSave = onHitResult.save;
  if (onHitResult.effects.length > 0) {
    emittedEffects.push(...onHitResult.effects);
  }
  if (onHitResult.actorDied) {
    actorDied = true;
  }

  const calledShotResult = applyCalledShotEffects({
    save: updatedSave,
    check,
    attacker,
    defender,
    didApplyDamage,
    finalDamage,
  });
  updatedSave = calledShotResult.save;

  const fireShieldResult = applyFireShieldBacklash({
    save: updatedSave,
    check,
    attacker,
    defender: updatedDefender,
    rng,
    storyPack,
    catalogs,
    effects: emittedEffects,
  });
  updatedSave = fireShieldResult.save;

  // Combine emitted effects with Called Shot effects
  const allEffects = [...(fireShieldResult.effects || []), ...calledShotResult.effects];

  // Log damage roll if damage was applied
  if (didApplyDamage && finalDamage > 0) {
    const combat = updatedSave.runtime.combat;
    const turnCounter = combat?.turnCounter ?? 0;
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "damage",
      attackerId: attacker.id,
      defenderId: defender.id,
      weaponId: calculatedWeaponId !== "unarmed" ? calculatedWeaponId : undefined,
      formula: fullFormula,
      rolls: damageRolls.length > 0 ? damageRolls : undefined,
      rawDamage,
      soak: effectiveSoak,
      touBonus,
      finalDamage,
      turnCounter,
      resolutionId,
      tags: fateDamageRerollUsed
        ? ["fate:damageReroll=1", `fate:damageRerollFrom=${fateDamageRerollFrom ?? 1}`]
        : undefined,
    });
  }

  const postDefender = updatedSave.actorsById[defender.id] ?? updatedDefender;
  const postHpAfter = maxHp - (postDefender.resources.wounds ?? 0);
  const targetKo = postHpAfter === 0 || postDefender.resources.isDead === true || actorDied;

  return {
    save: updatedSave,
    didApplyDamage,
    targetKo,
    finalDamage,
    effects: allEffects.length > 0 ? allEffects : undefined,
    actorDied,
  };
}
