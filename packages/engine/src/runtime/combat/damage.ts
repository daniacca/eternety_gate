import type {
  GameSave,
  CombatAttackCheck,
  CheckResult,
  ActorId,
  Effect,
  SingleCheck,
  StoryPack,
  StatKey,
} from "../types";
import type { IRNG } from "../rng";
import { resolveActor, performCheck } from "../checks";
import { calculateWeaponDamage, getActorArmor } from "./equipment";
import { appendCombatLog } from "./narration";
import { getEquippedWeaponId } from "../inventory";

/**
 * Applies combat damage when a combatAttack check hits
 * This is the single source of truth for damage application
 */
export function applyCombatDamageIfHit(
  check: CombatAttackCheck,
  result: CheckResult,
  save: GameSave,
  rng: IRNG,
  storyPack?: StoryPack
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

  // Get weapon ID from check or actor equipment
  const weaponId = check.attacker.weaponId ?? getEquippedWeaponId(attacker);
  const isUnarmed = !weaponId || weaponId === "unarmed" || !save.weaponsById?.[weaponId];
  const finalWeaponId = isUnarmed ? "unarmed" : weaponId;

  // Righteous Fury: check for critical success
  const isCriticalSuccess = result.critical === "autoSuccess" || result.critical === "epicSuccess";
  let rollsCount = 1;
  if (isCriticalSuccess && !isUnarmed) {
    const weapon = save.weaponsById?.[finalWeaponId];
    // Base rolls = 2 for all weapons
    rollsCount = 2;
    // Check for vengeful trait in tags (e.g., "vengeful" or "vengeful:3")
    if (weapon && weapon.tags) {
      const vengefulTag = weapon.tags.find((tag) => tag.startsWith("vengeful"));
      if (vengefulTag) {
        // Parse numeric value if present (e.g., "vengeful:3" -> 3)
        const match = vengefulTag.match(/vengeful:(\d+)/);
        const vengefulValue = match ? parseInt(match[1], 10) : 3; // Default to 3 if just "vengeful"
        if (vengefulValue > 2) {
          rollsCount = vengefulValue;
        }
      }
    }
  }

  // Calculate raw damage with weapon (using passed RNG for determinism)
  const {
    rawDamage,
    weaponName,
    weaponId: calculatedWeaponId,
  } = calculateWeaponDamage(save, attacker, weaponId, rng, rollsCount);

  // Get defender armor soak
  const { soak, armorId, name: armorName } = getActorArmor(save, defender);

  // Unarmed rules: double armor soak unless attacker has natural weapon flag
  let effectiveSoak = soak;
  if (isUnarmed) {
    const hasNaturalWeapon = attacker.tags?.includes("natural_weapon") || attacker.traits?.includes("natural_weapon");
    if (!hasNaturalWeapon) {
      effectiveSoak = soak * 2;
    }
  }

  // Calculate final damage after soak
  const finalDamage = Math.max(0, rawDamage - effectiveSoak);

  // Get current HP
  const hpBefore = defender.resources.hp;
  const hpAfter = Math.max(0, hpBefore - finalDamage);

  // Critical Damage Track: when defender is at 0 HP and takes damage
  let criticalDamage = defender.resources.criticalDamage ?? 0;
  let criticalTierApplied = defender.resources.criticalTierApplied ?? 0;
  const emittedEffects: Effect[] = [];
  let actorDied = false;

  if (hpBefore === 0 && finalDamage > 0 && !defender.resources.isDead) {
    criticalDamage += finalDamage;
    const newTier = Math.min(10, Math.floor(criticalDamage));

    // Apply effects only for tiers (criticalTierApplied+1 .. newTier), in order
    for (let tier = criticalTierApplied + 1; tier <= newTier; tier++) {
      if (tier === 1) {
        // Tier 1: +1 fatigue stack
        emittedEffects.push({
          op: "addCondition",
          actorId: defender.id,
          condition: "fatigue",
          stacks: 1,
          source: "criticalDamage",
        });
      } else if (tier === 2) {
        // Tier 2: +1d5 fatigue stacks, and a normal Toughness test; fail => stunned for (1d10 + DoF) rounds
        const fatigueRoll = rng.nextInt(1, 5);
        emittedEffects.push({
          op: "addCondition",
          actorId: defender.id,
          condition: "fatigue",
          stacks: fatigueRoll,
          source: "criticalDamage",
        });
        // Toughness test handled below after damage application
      } else if (tier === 3) {
        // Tier 3: bleeding (stacks 1) + reduce random physical stat by 1d5
        emittedEffects.push({
          op: "addCondition",
          actorId: defender.id,
          condition: "bleeding",
          stacks: 1,
          source: "criticalDamage",
        });
        // Stat reduction handled separately (future)
      } else if (tier === 4) {
        // Tier 4: reduce random physical stat by 1d10; hard Toughness test fail => prone
        // Stat reduction handled separately (future)
      } else if (tier === 5) {
        // Tier 5: prone and movement halved until medical care
        emittedEffects.push({
          op: "addCondition",
          actorId: defender.id,
          condition: "prone",
          source: "criticalDamage",
        });
      } else if (tier === 6) {
        // Tier 6: prone + stunned 1d5 rounds + bleeding
        const stunnedRounds = rng.nextInt(1, 5);
        emittedEffects.push({
          op: "addCondition",
          actorId: defender.id,
          condition: "stunned",
          durationTurns: stunnedRounds,
          source: "criticalDamage",
        });
        emittedEffects.push({
          op: "addCondition",
          actorId: defender.id,
          condition: "bleeding",
          stacks: 1,
          source: "criticalDamage",
        });
      } else if (tier === 7) {
        // Tier 7: normal Toughness test; fail => die
        const saveKey: StatKey = defender.stats.TOU != null ? "TOU" : "WIL";
        const toughnessCheck: SingleCheck = {
          id: `combat:criticalDamage:tier7:${defender.id}`,
          kind: "single",
          actorRef: { mode: "byId", actorId: defender.id },
          key: saveKey,
          difficulty: "NORMAL",
        };
        const toughnessResult = storyPack ? performCheck(toughnessCheck, storyPack, save, rng) : null;
        if (!toughnessResult || !toughnessResult.success) {
          actorDied = true;
        }
      } else if (tier === 8) {
        // Tier 8: hard Toughness test; fail => die
        const saveKey: StatKey = defender.stats.TOU != null ? "TOU" : "WIL";
        const toughnessCheck: SingleCheck = {
          id: `combat:criticalDamage:tier8:${defender.id}`,
          kind: "single",
          actorRef: { mode: "byId", actorId: defender.id },
          key: saveKey,
          difficulty: "HARD",
        };
        const toughnessResult = storyPack ? performCheck(toughnessCheck, storyPack, save, rng) : null;
        if (!toughnessResult || !toughnessResult.success) {
          actorDied = true;
        }
      } else if (tier === 9) {
        // Tier 9: very hard Toughness test; fail => die
        const saveKey: StatKey = defender.stats.TOU != null ? "TOU" : "WIL";
        const toughnessCheck: SingleCheck = {
          id: `combat:criticalDamage:tier9:${defender.id}`,
          kind: "single",
          actorRef: { mode: "byId", actorId: defender.id },
          key: saveKey,
          difficulty: "VERY_HARD",
        };
        const toughnessResult = storyPack ? performCheck(toughnessCheck, storyPack, save, rng) : null;
        if (!toughnessResult || !toughnessResult.success) {
          actorDied = true;
        }
      } else if (tier >= 10) {
        // Tier 10+: die immediately
        actorDied = true;
      }
    }

    criticalTierApplied = newTier;
  }

  // Update defender immutably
  const updatedDefender: typeof defender = {
    ...defender,
    resources: {
      ...defender.resources,
      hp: actorDied ? 0 : hpAfter,
      criticalDamage: criticalDamage > 0 ? criticalDamage : undefined,
      criticalTierApplied: criticalTierApplied > 0 ? criticalTierApplied : undefined,
      isDead: actorDied ? true : defender.resources.isDead,
    },
  };

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
            ...(isUnarmed ? ["combat:unarmed=1"] : []),
            ...(criticalDamage > 0 ? [`combat:criticalDamage=${criticalDamage}`] : []),
          ],
        }
      : lastCheck; // if null/undefined, leave it as is

  let updatedSave: GameSave = {
    ...save,
    actorsById: updatedActorsById,
    runtime: {
      ...save.runtime,
      lastCheck: updatedLastCheck,
      rngCounter: rng.getCounter(),
    },
  };

  // Add narration
  const defenderName = defender.name || "il bersaglio";
  const weaponIdForName = finalWeaponId === "unarmed" ? "unarmed" : finalWeaponId;
  const weaponNameForLog =
    weaponIdForName === "unarmed" ? "i pugni" : save.weaponsById?.[weaponIdForName]?.name || "l'arma";

  if (finalDamage === 0) {
    updatedSave = appendCombatLog(
      updatedSave,
      `${
        attacker.kind === "PC" ? "Colpisci" : attacker.name + " colpisce"
      } ${defenderName} con ${weaponNameForLog} ma l'armatura assorbe tutto il colpo (${rawDamage} - ${effectiveSoak}).`
    );
  } else {
    let damageMsg = `${
      attacker.kind === "PC" ? "Colpisci" : attacker.name + " colpisce"
    } ${defenderName} con ${weaponNameForLog} e infligge ${finalDamage} danni (${rawDamage} - ${effectiveSoak}).`;
    if (isCriticalSuccess) {
      damageMsg += ` Furia Giusta! (miglior risultato di ${rollsCount} tiri).`;
    }
    updatedSave = appendCombatLog(updatedSave, damageMsg);
  }

  // Add critical damage narration
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

  const targetKo = hpAfter === 0 || actorDied;
  const didApplyDamage = finalDamage > 0;

  return {
    save: updatedSave,
    didApplyDamage,
    targetKo,
    finalDamage,
    effects: emittedEffects.length > 0 ? emittedEffects : undefined,
    actorDied,
  };
}
