import type { GameSave, CombatAttackCheck, CheckResult, Effect, StoryPack, WeaponId } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import type { IRNG } from "../../rng";
import { resolveActor } from "../../checks";
import { appendRuntimeLog } from "../narration";
import { getEquippedWeaponId } from "../../characters/inventory";
import { applyDamageToActor } from "../criticalDamage";
import { getWeaponQuality } from "../../weaponQualities";
import { resolveDamageRollOutcome } from "./resolveDamageRollOutcome";
import { computeDamageAfterReductions } from "./computeDamageAfterReductions";
import { finalizeDamageApplication } from "./finalizeDamageApplication";
import { buildDamageFacts } from "../../hooks/facts";
import { runHooks } from "../../hooks";
import { buildPostDamageFacts } from "../../hooks/facts";

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

  const rollMode: "best" | "worst" | "normal" = "normal";
  const preliminaryWeaponId: WeaponId | "unarmed" | "improvised" =
    useFallbackWeapon ? "improvised" : weaponId ?? "unarmed";
  const rollFacts = buildDamageFacts({
    save,
    attacker,
    defender,
    check,
    weaponForPenetration:
      preliminaryWeaponId !== "unarmed" && preliminaryWeaponId !== "improvised"
        ? save.weaponsById?.[preliminaryWeaponId]
        : null,
    rawDamage: 0,
    damageOptions,
    catalogs,
    isMagicalSource,
    resultDos: result.dos,
    mode,
    rng,
    isUnarmed,
    useFallbackWeapon,
    calculatedWeaponId: preliminaryWeaponId,
  });
  const rollHookResult = runHooks("pre-damage", {
    save: updatedSave,
    storyPack,
    rng,
    attacker,
    defender,
    weapon,
    facts: {
      ...rollFacts,
      "damage.stage": "roll",
    },
  });
  const rollOutcome = resolveDamageRollOutcome({
    save,
    updatedSave,
    attacker,
    weaponId,
    mode,
    rollsCount,
    rng,
    catalogs,
    resolutionId,
    useFallbackWeapon,
    rollMode: rollHookResult.damageRollMode ?? rollMode,
    extraDice: rollHookResult.damageExtraDice,
    rerollOnes: rollHookResult.damageRerollOnes,
    allowFateReroll: rollHookResult.allowDamageReroll,
    fateRerollThreshold: rollHookResult.damageRerollThreshold ?? 1,
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
    rawDamage,
    damageFormula,
    calculatedWeaponId,
    useFallbackWeapon,
    isUnarmed,
    catalogs,
    facts: {
      ...buildDamageFacts({
        save,
        attacker,
        defender,
        check,
        weaponForPenetration: calculatedWeaponId !== "unarmed" && !useFallbackWeapon ? save.weaponsById?.[calculatedWeaponId] : null,
        rawDamage,
        damageOptions,
        catalogs,
        isMagicalSource,
        resultDos: result.dos,
        mode,
        rng,
        isUnarmed,
        useFallbackWeapon,
        calculatedWeaponId,
      }),
      "damage.stage": "apply",
    },
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

  const weaponForHitEffects =
    calculatedWeaponId !== "unarmed" && !useFallbackWeapon ? save.weaponsById?.[calculatedWeaponId] : null;
  const postDamageHookResult = runHooks("post-damage", {
    save: updatedSave,
    storyPack,
    rng,
    catalogs,
    attacker,
    defender: updatedDefender,
    weapon: weaponForHitEffects,
    isUnarmed,
    isNaturalWeaponAttack,
    didApplyDamage,
    resultDos: result.dos,
    finalDamage,
    check,
    facts: buildPostDamageFacts({
      save: updatedSave,
      attacker,
      defender: updatedDefender,
      check,
      weaponForHitEffects,
      isUnarmed,
      isNaturalWeaponAttack,
      didApplyDamage,
      resultDos: result.dos,
      finalDamage,
      rng,
      storyPack,
    }),
  });
  updatedSave = postDamageHookResult.save;
  if (postDamageHookResult.actorDied) {
    actorDied = true;
  }
  const allEffects = [...emittedEffects, ...postDamageHookResult.effects];

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
