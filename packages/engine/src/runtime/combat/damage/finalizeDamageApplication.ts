import type { Actor, Effect, GameSave } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import type { IRNG } from "../../rng";
import type { StoryPack } from "../../types";
import { appendCombatLog, appendRuntimeLog } from "../narration";
import { calculateMaxHp } from "../../characters/hp";
import { trackCombatDamage } from "../damageTracking";

export function finalizeDamageApplication(params: {
  save: GameSave;
  updatedSave: GameSave;
  attacker: Actor;
  defender: Actor;
  updatedDefender: Actor;
  damageResult: { effects?: Effect[]; actorDied?: boolean; dieHardUsed?: boolean };
  rawDamage: number;
  effectiveSoak: number;
  touBonus: number;
  finalDamage: number;
  calculatedWeaponId: string | "unarmed" | "improvised";
  armorId?: string;
  isCriticalSuccess: boolean;
  rollsCount: number;
  isUnarmed: boolean;
  useFallbackWeapon: boolean;
  rollMode: "best" | "worst" | "normal";
  fateDamageRerollUsed: boolean;
  fateDamageRerollFrom: number | null;
  resolutionId?: string;
  rng: IRNG;
  storyPack?: StoryPack;
  catalogs?: CharacterCatalogs;
}): {
  save: GameSave;
  updatedDefender: Actor;
  didApplyDamage: boolean;
  effects: Effect[];
  actorDied?: boolean;
  earlyReturn: boolean;
  maxHp: number;
  hpBefore: number;
  hpAfter: number;
} {
  const {
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
    catalogs,
  } = params;

  let nextSave = updatedSave;
  const emittedEffects: Effect[] = [...(damageResult.effects || [])];
  const actorDied = damageResult.actorDied;
  const dieHardUsed = damageResult.dieHardUsed ?? false;

  if (dieHardUsed) {
    const updatedActorsById = {
      ...save.actorsById,
      [defender.id]: updatedDefender,
    };

    nextSave = {
      ...nextSave,
      actorsById: updatedActorsById,
      runtime: {
        ...nextSave.runtime,
        rngCounter: rng.getCounter(),
      },
    };

    const defenderName = defender.name || "il bersaglio";
    const dieHardLog =
      defender.kind === "PC"
        ? `Resisti alla morte spendendo un Punto Fato! (Duro a Morire)`
        : `${defenderName} resiste alla morte spendendo un Punto Fato! (Duro a Morire)`;
    nextSave = appendCombatLog(nextSave, dieHardLog);

    nextSave = appendRuntimeLog(nextSave, {
      kind: "system",
      message: `Die Hard: ${defender.id} resists death by spending 1 Fate Point to negate ${finalDamage} damage`,
      turnCounter: save.runtime.combat?.turnCounter ?? 0,
      resolutionId,
      tags: ["talent:dieHard", `damage:negated=${finalDamage}`, "dieHard:resistDeath"],
    });

    return {
      save: nextSave,
      updatedDefender,
      didApplyDamage: false,
      effects: emittedEffects,
      actorDied,
      earlyReturn: true,
      maxHp: 0,
      hpBefore: 0,
      hpAfter: 0,
    };
  }

  const maxHp = catalogs ? calculateMaxHp(save, updatedDefender, catalogs) : updatedDefender.derived?.hpMax ?? 100;
  const woundsAfter = updatedDefender.resources.wounds ?? 0;
  const hpAfter = maxHp - woundsAfter;
  const woundsBefore = defender.resources.wounds ?? 0;
  const hpBefore = maxHp - woundsBefore;

  const updatedActorsById = {
    ...nextSave.actorsById,
    [defender.id]: updatedDefender,
  };

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
            ...(rollMode !== "normal" ? [rollMode === "best" ? "roll:advantage" : "roll:disadvantage"] : []),
            ...((updatedDefender.resources.criticalDamage ?? 0) > 0
              ? [`combat:criticalDamage=${updatedDefender.resources.criticalDamage}`]
              : []),
            ...(fateDamageRerollUsed
              ? [
                  "fate:damageReroll=1",
                  `fate:damageRerollFrom=${fateDamageRerollFrom ?? 1}`,
                  `fate:damageRerollTo=${rawDamage}`,
                ]
              : []),
          ],
        }
      : lastCheck;

  nextSave = {
    ...nextSave,
    actorsById: updatedActorsById,
    runtime: {
      ...nextSave.runtime,
      lastCheck: updatedLastCheck,
      rngCounter: rng.getCounter(),
    },
  };

  const defenderName = defender.name || "il bersaglio";
  let weaponNameForLog: string;
  if (useFallbackWeapon) {
    weaponNameForLog = "un'arma di fortuna";
  } else if (calculatedWeaponId === "unarmed") {
    weaponNameForLog = "i pugni";
  } else {
    weaponNameForLog = save.weaponsById?.[calculatedWeaponId]?.name || "l'arma";
  }

  if (useFallbackWeapon && attacker.kind === "PC") {
    nextSave = appendCombatLog(nextSave, "Usi in mischia un'arma di fortuna.");
  }

  if (finalDamage === 0) {
    const reductionParts = [];
    if (effectiveSoak > 0) reductionParts.push(`Armatura: ${effectiveSoak}`);
    if (touBonus > 0) reductionParts.push(`RES: ${touBonus}`);
    const reductionText = reductionParts.length > 0 ? reductionParts.join(", ") : "riduzione";

    nextSave = appendCombatLog(
      nextSave,
      `${
        attacker.kind === "PC" ? "Colpisci" : attacker.name + " colpisce"
      } ${defenderName} con ${weaponNameForLog} ma la difesa assorbe tutto il colpo (${rawDamage} - ${reductionText}).`,
    );
  } else {
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
    nextSave = appendCombatLog(nextSave, damageMsg);
  }

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
      criticalMsg = defender.kind === "PC" ? `Sei in condizioni critiche!` : `${defenderName} è in condizioni critiche!`;
    } else if (tier >= 5) {
      criticalMsg =
        defender.kind === "PC" ? `Sei a terra e gravemente ferito!` : `${defenderName} è a terra e gravemente ferito!`;
    } else if (tier >= 3) {
      criticalMsg = defender.kind === "PC" ? `Sanguini copiosamente!` : `${defenderName} sanguina copiosamente!`;
    }
    if (criticalMsg) {
      nextSave = appendCombatLog(nextSave, criticalMsg);
    }
  }

  const didApplyDamage = finalDamage > 0;
  if (didApplyDamage) {
    nextSave = trackCombatDamage(nextSave, attacker.id, defender.id, finalDamage);
  }

  return {
    save: nextSave,
    updatedDefender,
    didApplyDamage,
    effects: emittedEffects,
    actorDied,
    earlyReturn: false,
    maxHp,
    hpBefore,
    hpAfter,
  };
}
