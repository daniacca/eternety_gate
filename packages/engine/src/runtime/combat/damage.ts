import type { GameSave, CombatAttackCheck, CheckResult, Effect, StoryPack, WeaponId, SingleCheck } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import type { IRNG } from "../rng";
import { performCheckWithSave, resolveActor } from "../checks";
import { calculateWeaponDamage, getActorArmor } from "./equipment";
import { appendCombatLog, appendRuntimeLog } from "./narration";
import { getEquippedWeaponId } from "../characters/inventory";
import { getCharacteristicBonus } from "../characters/bonuses";
import { getRangedDamageBonusFromMightyShot } from "../characters/mightyShot";
import { calculateMaxHp } from "../characters/hp";
import { applyDamageToActor } from "./criticalDamage";
import { getModifierTotal } from "../characters/modifiers";
import { trackCombatDamage } from "./damageTracking";
import { hasTrait } from "../characters/prerequisites";
import { getMagicPower } from "../magic/pm";
import { getWeaponQuality, getWeaponQualityRank, hasWeaponQuality } from "../weaponQualities";

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
  isMagicalSource: boolean = false
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

  // Calculate raw damage with weapon (using passed RNG for determinism)
  let rawDamage: number;
  let weaponName: string;
  let calculatedWeaponId: WeaponId | "unarmed" | "improvised";
  let damageRolls: number[] = [];
  let damageFormula: string = "";

  if (useFallbackWeapon) {
    // Improvised melee weapon: 1d5 + STR bonus, no penetration
    let bestRoll = 0;
    const strBonus = getCharacteristicBonus(save, attacker.id, "STR");
    for (let i = 0; i < rollsCount; i++) {
      const dieRoll = rng.nextInt(1, 5);
      const rollTotal = dieRoll + strBonus;
      damageRolls.push(rollTotal);
      if (rollTotal > bestRoll) {
        bestRoll = rollTotal;
      }
    }
    rawDamage = bestRoll;
    weaponName = "Arma di fortuna";
    calculatedWeaponId = "improvised";

    // Build formula
    const formulaParts: string[] = ["1d5"];
    if (strBonus > 0) {
      formulaParts.push(`${strBonus} (STR)`);
    }
    damageFormula = formulaParts.join(" + ");
  } else {
    const weaponForQualities = weaponId && weaponId !== "unarmed" ? save.weaponsById?.[weaponId] : null;
    const hasAccurate = hasWeaponQuality(weaponForQualities, "accurate");
    const accurateExtraDice = hasAccurate ? Math.floor(result.dos / 2) : 0;
    const hasTearing = hasWeaponQuality(weaponForQualities, "tearing");
    const forceBonus =
      hasWeaponQuality(weaponForQualities, "force") && hasTrait(attacker, "trait:weaver")
        ? getMagicPower(save, attacker.id, catalogs)
        : 0;

    const damageCalc = calculateWeaponDamage(save, attacker, weaponId, rng, mode, rollsCount, catalogs, {
      tearing: hasTearing,
      extraDice: accurateExtraDice,
    });
    rawDamage = damageCalc.rawDamage;
    if (forceBonus > 0) {
      rawDamage += forceBonus;
    }
    weaponName = damageCalc.weaponName;
    calculatedWeaponId = damageCalc.weaponId;

    if (accurateExtraDice > 0) {
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "system",
        message: `Accurate: +${accurateExtraDice}d10 damage dice`,
        turnCounter: save.runtime.combat?.turnCounter ?? 0,
        resolutionId,
        tags: ["weapon:accurate", `extraDice=${accurateExtraDice}`],
      });
    }

    // Build formula string for logging
    const weapon = calculatedWeaponId !== "unarmed" ? save.weaponsById?.[calculatedWeaponId] : null;
    if (weapon) {
      // Format damage tier as dice notation
      const tierToDice = {
        fixed: "0",
        half: "1d5",
        single: "1d10",
        double: "2d10",
        triple: "3d10",
        quadfold: "4d10",
        fivefold: "5d10",
      };
      const diceNotation = tierToDice[weapon.damage.tier];

      // Build formula components
      const formulaParts: string[] = [diceNotation];

      // Add weapon damage bonus only if > 0
      if (weapon.damage.add > 0) {
        formulaParts.push(`${weapon.damage.add} (weapon)`);
      }

      if (mode === "MELEE") {
        const strBonus = getCharacteristicBonus(save, attacker.id, "STR", catalogs);
        if (strBonus > 0) {
          formulaParts.push(`${strBonus} (STR)`);
        }
      } else if (mode === "RANGED") {
        // Get Mighty Shot bonus for formula display
        const mightyShotBonus = catalogs ? getRangedDamageBonusFromMightyShot(save, catalogs, attacker.id) : 0;
        if (mightyShotBonus > 0) {
          formulaParts.push(`${mightyShotBonus} (Mighty Shot)`);
        }
      }

      if (accurateExtraDice > 0) {
        formulaParts.push(`${accurateExtraDice}d10 (Accurate)`);
      }
      if (forceBonus > 0) {
        formulaParts.push(`${forceBonus} (Force)`);
      }
      damageFormula = formulaParts.join(" + ");
    } else {
      // Unarmed
      const strBonus = getCharacteristicBonus(save, attacker.id, "STR", catalogs);
      const formulaParts: string[] = ["1d5"];
      if (strBonus > 0) {
        formulaParts.push(`${strBonus} (STR)`);
      }
      if (forceBonus > 0) {
        formulaParts.push(`${forceBonus} (Force)`);
      }
      damageFormula = formulaParts.join(" + ");
    }
  }

  // Get defender armor soak
  const { soak, armorId } = getActorArmor(save, defender);
  const machineSoak = catalogs ? getModifierTotal(save, catalogs, defender.id, "combat.machineSoak") : 0;
  const naturalArmorSoak = catalogs ? getModifierTotal(save, catalogs, defender.id, "combat.naturalArmor") : 0;

  // Get weapon for penetration calculation
  const weaponForPenetration =
    calculatedWeaponId !== "unarmed" && !useFallbackWeapon ? save.weaponsById?.[calculatedWeaponId] : null;
  const forcePenBonus =
    weaponForPenetration && hasWeaponQuality(weaponForPenetration, "force") && hasTrait(attacker, "trait:weaver")
      ? getMagicPower(save, attacker.id, catalogs)
      : 0;
  const razorSharpActive =
    weaponForPenetration && hasWeaponQuality(weaponForPenetration, "razor_sharp") && result.dos >= 3;
  const basePenetration = weaponForPenetration ? weaponForPenetration.penetration + forcePenBonus : 0;
  const effectivePenetration = razorSharpActive ? basePenetration * 2 : basePenetration;

  // Unarmed/improvised rules: double armor soak unless attacker has natural weapon flag
  let effectiveSoak = soak;
  if (isUnarmed || useFallbackWeapon) {
    const hasNaturalWeapon =
      attacker.tags?.includes("natural_weapon") || (attacker.traits && "trait:natural_weapons" in attacker.traits);
    if (!hasNaturalWeapon) {
      effectiveSoak = soak * 2;
    }
  } else if (weaponForPenetration) {
    // Apply weapon penetration: penetration ignores that much armor soak
    // Penetration reduces effective soak (but not below 0)
    effectiveSoak = Math.max(0, soak - effectivePenetration);
  }
  const extraSoak = machineSoak > 0 ? machineSoak : naturalArmorSoak;
  if (extraSoak > 0) {
    effectiveSoak += extraSoak;
  }

  // Get defender TOU bonus (always reduces damage)
  let touBonus = getCharacteristicBonus(save, defender.id, "TOU", catalogs);
  const fellingRank = weaponForPenetration ? getWeaponQualityRank(weaponForPenetration, "felling") : null;
  if (fellingRank && fellingRank > 0) {
    const reduced = Math.max(0, touBonus - fellingRank);
    if (reduced !== touBonus) {
      touBonus = reduced;
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "system",
        message: `Felling: Toughness Bonus reduced by ${fellingRank}`,
        turnCounter: save.runtime.combat?.turnCounter ?? 0,
        resolutionId,
        tags: ["weapon:felling", `reduction=${fellingRank}`],
      });
    }
  }
  if (isMagicalSource) {
    const daemonicParams = defender.traits?.["trait:daemonic"];
    const daemonicBonus = typeof daemonicParams === "object" && typeof daemonicParams.x === "number" ? daemonicParams.x : 0;
    if (daemonicBonus > 0) {
      touBonus = Math.max(0, touBonus - daemonicBonus);
    }
  }
  if (weaponForPenetration && hasWeaponQuality(weaponForPenetration, "sanctified")) {
    const spiritualParams = defender.traits?.["trait:daemonic_spiritual"];
    const spiritualBonus = typeof spiritualParams === "object" && typeof spiritualParams.x === "number" ? spiritualParams.x : 0;
    if (spiritualBonus > 0) {
      touBonus = Math.max(0, touBonus - spiritualBonus);
    }
  }
  if (razorSharpActive) {
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Razor Sharp: penetration doubled to ${effectivePenetration}`,
      turnCounter: save.runtime.combat?.turnCounter ?? 0,
      resolutionId,
      tags: ["weapon:razor_sharp", `penetration=${effectivePenetration}`],
    });
  }

  // Calculate final damage after soak and TOU bonus
  // Formula: (raw damage - armor soak - TOU bonus - other reductions)
  let finalDamage = Math.max(0, rawDamage - effectiveSoak - touBonus);

  // Called Shot: Head doubles damage after soak
  const calledShotZone = check.modifiers?.calledShotZone;
  if (check.modifiers?.calledShot && calledShotZone === "head" && finalDamage > 0) {
    finalDamage = finalDamage * 2;
  }

  // Build reduction formula for display
  const reductionFormula = `${rawDamage} (Raw) - ${touBonus} (TOU) - ${effectiveSoak} (Soak)`;

  // Combine raw damage formula with reduction formula
  const fullFormula = `${damageFormula} | ${reductionFormula}`;

  // Apply damage using centralized function
  const damageResult = applyDamageToActor(defender, finalDamage, updatedSave, rng, storyPack, catalogs);
  const updatedDefender = damageResult.updatedActor;
  const emittedEffects: Effect[] = [...(damageResult.effects || [])];
  let actorDied = damageResult.actorDied;
  const dieHardUsed = damageResult.dieHardUsed ?? false;

  // If Die Hard was used, return early with special handling
  if (dieHardUsed) {
    const updatedActorsById = {
      ...save.actorsById,
      [defender.id]: updatedDefender,
    };

    updatedSave = {
      ...updatedSave,
      actorsById: updatedActorsById,
      runtime: {
        ...updatedSave.runtime,
        rngCounter: rng.getCounter(),
      },
    };

    // Log Die Hard usage - now only triggers when resisting death (HP would go to 0)
    const defenderName = defender.name || "il bersaglio";
    const dieHardLog =
      defender.kind === "PC"
        ? `Resisti alla morte spendendo un Punto Fato! (Duro a Morire)`
        : `${defenderName} resiste alla morte spendendo un Punto Fato! (Duro a Morire)`;
    updatedSave = appendCombatLog(updatedSave, dieHardLog);

    // Log system entry
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Die Hard: ${defender.id} resists death by spending 1 Fate Point to negate ${finalDamage} damage`,
      turnCounter: save.runtime.combat?.turnCounter ?? 0,
      resolutionId,
      tags: ["talent:dieHard", `damage:negated=${finalDamage}`, "dieHard:resistDeath"],
    });

    return {
      save: updatedSave,
      didApplyDamage: false,
      targetKo: false,
      finalDamage: 0,
    };
  }

  // Calculate HP values for logging
  const maxHp = catalogs ? calculateMaxHp(save, updatedDefender, catalogs) : updatedDefender.derived?.hpMax ?? 100;
  const woundsAfter = updatedDefender.resources.wounds ?? 0;
  const hpAfter = maxHp - woundsAfter;
  const woundsBefore = defender.resources.wounds ?? 0;
  const hpBefore = maxHp - woundsBefore;

  // Update actorsById immutably
  const updatedActorsById = {
    ...save.actorsById,
    [defender.id]: updatedDefender,
  };

  // Update lastCheck tags immutably
  const lastCheck = save.runtime.lastCheck;
  const prevTags = lastCheck && lastCheck !== null ? lastCheck.tags : [];

  const updatedLastCheck =
    lastCheck && lastCheck !== null
      ? {
          ...lastCheck,
          tags: [
            ...prevTags,
            `combat:damage:raw=${rawDamage}`,
            `combat:soak=${effectiveSoak}`,
            `combat:damage:final=${finalDamage}`,
            `combat:weapon=${calculatedWeaponId}`,
            `combat:armor=${armorId}`,
            `combat:defHpBefore=${hpBefore}`,
            `combat:defHpAfter=${hpAfter}`,
            ...(hpAfter === 0 ? ["combat:defDown=1"] : []),
            ...(isCriticalSuccess ? ["combat:righteousFury=1", `combat:righteousFury:rolls=${rollsCount}`] : []),
            ...(isUnarmed ? ["combat:unarmed=1", "combat:fallbackWeapon=unarmed"] : []),
            ...(useFallbackWeapon ? ["combat:fallbackWeapon=improvised"] : []),
            ...((updatedDefender.resources.criticalDamage ?? 0) > 0
              ? [`combat:criticalDamage=${updatedDefender.resources.criticalDamage}`]
              : []),
          ],
        }
      : lastCheck; // if null/undefined, leave it as is

  updatedSave = {
    ...updatedSave,
    actorsById: updatedActorsById,
    runtime: {
      ...updatedSave.runtime,
      lastCheck: updatedLastCheck,
      rngCounter: rng.getCounter(),
    },
  };

  // Add narration
  const defenderName = defender.name || "il bersaglio";
  let weaponNameForLog: string;
  if (useFallbackWeapon) {
    weaponNameForLog = "un'arma di fortuna";
  } else if (calculatedWeaponId === "unarmed") {
    weaponNameForLog = "i pugni";
  } else {
    weaponNameForLog = save.weaponsById?.[calculatedWeaponId]?.name || "l'arma";
  }

  // Add fallback narration if using improvised weapon
  if (useFallbackWeapon && attacker.kind === "PC") {
    updatedSave = appendCombatLog(updatedSave, "Usi in mischia un'arma di fortuna.");
  }

  if (finalDamage === 0) {
    // Build reduction breakdown for logging
    const reductionParts = [];
    if (effectiveSoak > 0) reductionParts.push(`Armatura: ${effectiveSoak}`);
    if (touBonus > 0) reductionParts.push(`RES: ${touBonus}`);
    const reductionText = reductionParts.length > 0 ? reductionParts.join(", ") : "riduzione";

    updatedSave = appendCombatLog(
      updatedSave,
      `${
        attacker.kind === "PC" ? "Colpisci" : attacker.name + " colpisce"
      } ${defenderName} con ${weaponNameForLog} ma la difesa assorbe tutto il colpo (${rawDamage} - ${reductionText}).`
    );
  } else {
    // Build reduction breakdown for logging
    const reductionParts = [];
    if (effectiveSoak > 0) reductionParts.push(`${effectiveSoak}`);
    if (touBonus > 0) reductionParts.push(`${touBonus}`);
    const reductionText = reductionParts.join(" + ");

    let damageMsg = `${
      attacker.kind === "PC" ? "Colpisci" : attacker.name + " colpisce"
    } ${defenderName} con ${weaponNameForLog} e infligge ${finalDamage} danni (${rawDamage} - ${reductionText}).`;
    if (isCriticalSuccess) {
      damageMsg += ` Furia Giusta! (miglior risultato di ${rollsCount} tiri).`;
    }
    updatedSave = appendCombatLog(updatedSave, damageMsg);
  }

  // Add critical damage narration
  const criticalDamage = updatedDefender.resources.criticalDamage ?? 0;
  if (hpBefore === 0 && finalDamage > 0 && criticalDamage > 0) {
    const tier = Math.min(10, Math.floor(criticalDamage));
    let criticalMsg = "";
    if (actorDied) {
      criticalMsg = defender.kind === "PC" ? `Sei morto!` : `${defenderName} è morto!`;
    } else if (tier >= 10) {
      criticalMsg =
        defender.kind === "PC"
          ? `Sei stato gravemente ferito e rischi la morte!`
          : `${defenderName} è stato gravemente ferito e rischia la morte!`;
    } else if (tier >= 7) {
      criticalMsg =
        defender.kind === "PC" ? `Sei in condizioni critiche!` : `${defenderName} è in condizioni critiche!`;
    } else if (tier >= 5) {
      criticalMsg =
        defender.kind === "PC" ? `Sei a terra e gravemente ferito!` : `${defenderName} è a terra e gravemente ferito!`;
    } else if (tier >= 3) {
      criticalMsg = defender.kind === "PC" ? `Sanguini copiosamente!` : `${defenderName} sanguina copiosamente!`;
    }
    if (criticalMsg) {
      updatedSave = appendCombatLog(updatedSave, criticalMsg);
    }
  }

  const didApplyDamage = finalDamage > 0;
  if (didApplyDamage) {
    updatedSave = trackCombatDamage(updatedSave, attacker.id, defender.id, finalDamage);
  }

  // Weapon qualities: on-hit effects (only if final damage >= 1)
  const weaponForHitEffects =
    calculatedWeaponId !== "unarmed" && !useFallbackWeapon ? save.weaponsById?.[calculatedWeaponId] : null;
  if (didApplyDamage && weaponForHitEffects) {
    if (hasWeaponQuality(weaponForHitEffects, "shocking")) {
      const fatigueRoll = rng.nextInt(1, 5);
      const stunnedDuration = Math.ceil(result.dos / 2);
      emittedEffects.push({
        op: "addCondition",
        actorId: defender.id,
        condition: "fatigue",
        stacks: fatigueRoll,
        source: "weapon:shocking",
      });
      if (stunnedDuration > 0) {
        emittedEffects.push({
          op: "addCondition",
          actorId: defender.id,
          condition: "stunned",
          durationTurns: stunnedDuration,
          source: "weapon:shocking",
        });
      }
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "system",
        message: `Shocking: fatigue ${fatigueRoll}, stunned ${stunnedDuration} rounds`,
        turnCounter: save.runtime.combat?.turnCounter ?? 0,
        resolutionId,
        tags: ["weapon:shocking", `fatigue=${fatigueRoll}`, `stunned=${stunnedDuration}`],
      });
    }

    const toxicRank = getWeaponQualityRank(weaponForHitEffects, "toxic");
    if (toxicRank && toxicRank > 0 && storyPack) {
      const toxicCheck: SingleCheck = {
        id: `combat:toxic:${attacker.id}:${defender.id}`,
        kind: "single",
        actorRef: { mode: "byId", actorId: defender.id },
        key: "TOU",
        difficulty: "Challenging",
        modifier: -10 * toxicRank,
      };
      const { result: toxicResult, save: saveAfterToxicCheck } = performCheckWithSave(
        toxicCheck,
        storyPack,
        updatedSave,
        rng,
        resolutionId ? `${resolutionId}:toxic` : undefined
      );
      updatedSave = {
        ...saveAfterToxicCheck,
        runtime: {
          ...saveAfterToxicCheck.runtime,
          rngCounter: rng.getCounter(),
        },
      };
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "system",
        message: `Toxic: ${defender.id} ${toxicResult?.success ? "resists" : "fails"} (rank ${toxicRank})`,
        turnCounter: save.runtime.combat?.turnCounter ?? 0,
        resolutionId,
        tags: ["weapon:toxic", `rank=${toxicRank}`, `success=${toxicResult?.success ? 1 : 0}`],
      });

      if (!toxicResult?.success) {
        const directDamage = rng.nextInt(1, 10);
        const currentDefender = updatedSave.actorsById[defender.id] ?? defender;
        const toxicDamageResult = applyDamageToActor(currentDefender, directDamage, updatedSave, rng, storyPack, catalogs);
        const toxicDefender = toxicDamageResult.updatedActor;
        if (toxicDamageResult.actorDied) {
          actorDied = true;
        }
        updatedSave = {
          ...updatedSave,
          actorsById: {
            ...updatedSave.actorsById,
            [defender.id]: toxicDefender,
          },
          runtime: {
            ...updatedSave.runtime,
            rngCounter: rng.getCounter(),
          },
        };
        if (toxicDamageResult.effects.length > 0) {
          emittedEffects.push(...toxicDamageResult.effects);
        }
        updatedSave = appendRuntimeLog(updatedSave, {
          kind: "system",
          message: `Toxic: ${defender.id} suffers ${directDamage} direct damage`,
          turnCounter: save.runtime.combat?.turnCounter ?? 0,
          resolutionId,
          tags: ["weapon:toxic", `damage=${directDamage}`, "direct=1"],
        });
      }
    }

    if (hasWeaponQuality(weaponForHitEffects, "sanctified") && storyPack) {
      const hasInstability = defender.traits?.["trait:spiritual_instability"] !== undefined;
      if (hasInstability) {
        const penalty = -10 - 5 * result.dos;
        const instabilityCheck: SingleCheck = {
          id: `combat:sanctified:instability:${defender.id}`,
          kind: "single",
          actorRef: { mode: "byId", actorId: defender.id },
          key: "WIL",
          difficulty: "Challenging",
          modifier: penalty,
        };
        const { result: instabilityResult, save: saveAfterCheck } = performCheckWithSave(
          instabilityCheck,
          storyPack,
          updatedSave,
          rng,
          resolutionId ? `${resolutionId}:sanctified` : undefined
        );
        updatedSave = {
          ...saveAfterCheck,
          runtime: {
            ...saveAfterCheck.runtime,
            rngCounter: rng.getCounter(),
          },
        };
        updatedSave = appendRuntimeLog(updatedSave, {
          kind: "system",
          message: `Sanctified: spiritual instability ${instabilityResult?.success ? "resisted" : "triggered"}`,
          turnCounter: save.runtime.combat?.turnCounter ?? 0,
          resolutionId,
          tags: ["weapon:sanctified", `success=${instabilityResult?.success ? 1 : 0}`, `penalty=${penalty}`],
        });

        if (instabilityResult && !instabilityResult.success) {
          const backlashDamage = 1 + instabilityResult.dof;
          const currentDefender = updatedSave.actorsById[defender.id] ?? defender;
          const instabilityDamageResult = applyDamageToActor(currentDefender, backlashDamage, updatedSave, rng, storyPack, catalogs);
          const instabilityDefender = instabilityDamageResult.updatedActor;
          if (instabilityDamageResult.actorDied) {
            actorDied = true;
          }
          updatedSave = {
            ...updatedSave,
            actorsById: {
              ...updatedSave.actorsById,
              [defender.id]: instabilityDefender,
            },
            runtime: {
              ...updatedSave.runtime,
              rngCounter: rng.getCounter(),
            },
          };
          if (instabilityDamageResult.effects.length > 0) {
            emittedEffects.push(...instabilityDamageResult.effects);
          }
          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "system",
            message: `Sanctified: ${defender.id} suffers ${backlashDamage} instability damage`,
            turnCounter: save.runtime.combat?.turnCounter ?? 0,
            resolutionId,
            tags: ["weapon:sanctified", "spirit:instability", `damage=${backlashDamage}`],
          });
        }
      }
    }
  }

  // Called Shot effects on successful hit (only if damage > 0)
  const calledShotEffects: Effect[] = [];
  if (check.modifiers?.calledShot && didApplyDamage && calledShotZone) {
    if (calledShotZone === "arms") {
      // Arms: Apply Disarm effect
      calledShotEffects.push({
        op: "combatDisarm",
        attackerId: attacker.id,
        defenderId: defender.id,
      });
      updatedSave = appendCombatLog(
        updatedSave,
        attacker.kind === "PC"
          ? `Il colpo al braccio disarma ${defender.name || "il bersaglio"}!`
          : `${attacker.name} disarma ${defender.name || "il bersaglio"} con un colpo al braccio!`
      );
    } else if (calledShotZone === "legs") {
      // Legs: Apply Prone + halved movement until end of next turn
      calledShotEffects.push({
        op: "addCondition",
        actorId: defender.id,
        condition: "prone",
        source: "calledShot:legs",
      });
      calledShotEffects.push({
        op: "addCondition",
        actorId: defender.id,
        condition: "halvedMovement",
        durationTurns: 2, // Until end of next turn
        source: "calledShot:legs",
      });
      updatedSave = appendCombatLog(
        updatedSave,
        attacker.kind === "PC"
          ? `Il colpo alla gamba fa cadere ${defender.name || "il bersaglio"} a terra con movimento dimezzato!`
          : `${attacker.name} fa cadere ${defender.name || "il bersaglio"} a terra con movimento dimezzato!`
      );
    } else if (calledShotZone === "head" && finalDamage > 0) {
      // Head: Log damage doubling (already applied above)
      updatedSave = appendCombatLog(
        updatedSave,
        attacker.kind === "PC"
          ? `Il colpo alla testa infligge danni raddoppiati!`
          : `${attacker.name} colpisce alla testa con danni raddoppiati!`
      );
    }
  }

  // Combine emitted effects with Called Shot effects
  const allEffects = [...(emittedEffects || []), ...calledShotEffects];

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
