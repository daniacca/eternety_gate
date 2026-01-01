import type { GameSave, CombatAttackCheck, CheckResult, ActorId, Effect } from "../types";
import type { IRNG } from "../rng";
import { resolveActor } from "../checks";
import { calculateWeaponDamage, getActorArmor } from "./equipment";
import { appendCombatLog } from "./narration";

/**
 * Applies combat damage when a combatAttack check hits
 * This is the single source of truth for damage application
 */
export function applyCombatDamageIfHit(
  check: CombatAttackCheck,
  result: CheckResult,
  save: GameSave,
  rng: IRNG
): {
  save: GameSave;
  didApplyDamage: boolean;
  targetKo: boolean;
  finalDamage?: number;
  effects?: Effect[];
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
  const weaponId = check.attacker.weaponId ?? attacker.equipment?.weaponId ?? null;

  // Calculate raw damage with weapon (using passed RNG for determinism)
  const { rawDamage, weaponName, weaponId: finalWeaponId } = calculateWeaponDamage(save, attacker, weaponId, rng);

  // Get defender armor soak
  const { soak, armorId, name: armorName } = getActorArmor(save, defender);

  // Calculate final damage after soak
  const finalDamage = Math.max(0, rawDamage - soak);

  // Get current HP
  const hpBefore = defender.resources.hp;
  const hpAfter = Math.max(0, hpBefore - finalDamage);

  // Update defender immutably
  const updatedDefender: typeof defender = {
    ...defender,
    resources: {
      ...defender.resources,
      hp: hpAfter,
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
            `combat:soak=${soak}`,
            `combat:damage:final=${finalDamage}`,
            `combat:weapon=${finalWeaponId}`,
            `combat:armor=${armorId}`,
            `combat:defHpBefore=${hpBefore}`,
            `combat:defHpAfter=${hpAfter}`,
            ...(hpAfter === 0 ? ["combat:defDown=1"] : []),
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
      } ${defenderName} con ${weaponNameForLog} ma l'armatura assorbe tutto il colpo (${rawDamage} - ${soak}).`
    );
  } else {
    updatedSave = appendCombatLog(
      updatedSave,
      `${
        attacker.kind === "PC" ? "Colpisci" : attacker.name + " colpisce"
      } ${defenderName} con ${weaponNameForLog} e infligge ${finalDamage} danni (${rawDamage} - ${soak}).`
    );
  }

  const targetKo = hpAfter === 0;
  const didApplyDamage = finalDamage > 0;

  return {
    save: updatedSave,
    didApplyDamage,
    targetKo,
    finalDamage,
  };
}
