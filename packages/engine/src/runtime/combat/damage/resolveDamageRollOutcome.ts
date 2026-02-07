import type { Actor, CheckResult, GameSave, WeaponId } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import type { IRNG } from "../../rng";
import { consumeFateProtection, isFateProtectionActive } from "../../characters/fate";
import { rollWeaponDamage } from "./rollWeaponDamage";

export function resolveDamageRollOutcome(params: {
  save: GameSave;
  updatedSave: GameSave;
  attacker: Actor;
  weaponId: WeaponId | "unarmed" | "improvised" | null;
  mode: "MELEE" | "RANGED";
  rollsCount: number;
  result: CheckResult;
  rng: IRNG;
  catalogs?: CharacterCatalogs;
  resolutionId?: string;
  isUnarmed: boolean;
  useFallbackWeapon: boolean;
  hasUnarmedSpecialist: boolean;
  rollMode: "best" | "worst" | "normal";
}): {
  updatedSave: GameSave;
  outcome: ReturnType<typeof rollWeaponDamage>["outcome"];
  fateDamageRerollUsed: boolean;
  fateDamageRerollFrom: number | null;
} {
  const {
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
  } = params;

  let nextSave = updatedSave;
  let accurateLogged = false;
  let fateDamageRerollUsed = false;
  let fateDamageRerollFrom: number | null = null;

  let rollResult = rollWeaponDamage(
    {
      save,
      updatedSave: nextSave,
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
    },
    accurateLogged,
  );
  nextSave = rollResult.updatedSave;
  accurateLogged = rollResult.accurateLogged;
  let damageOutcome = rollResult.outcome;

  if (rollMode !== "normal") {
    rollResult = rollWeaponDamage(
      {
        save,
        updatedSave: nextSave,
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
      },
      accurateLogged,
    );
    nextSave = rollResult.updatedSave;
    accurateLogged = rollResult.accurateLogged;
    const altOutcome = rollResult.outcome;
    const shouldUseAlt =
      rollMode === "best"
        ? altOutcome.rawDamage > damageOutcome.rawDamage
        : altOutcome.rawDamage < damageOutcome.rawDamage;
    if (shouldUseAlt) {
      damageOutcome = altOutcome;
    }
  }

  if (isFateProtectionActive(attacker) && damageOutcome.rawDamage === 1) {
    const consumeResult = consumeFateProtection(nextSave, attacker.id);
    if (consumeResult.consumed) {
      nextSave = consumeResult.save;
      fateDamageRerollUsed = true;
      fateDamageRerollFrom = damageOutcome.rawDamage;
      rollResult = rollWeaponDamage(
        {
          save,
          updatedSave: nextSave,
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
        },
        accurateLogged,
      );
      nextSave = rollResult.updatedSave;
      accurateLogged = rollResult.accurateLogged;
      damageOutcome = rollResult.outcome;
    }
  }

  return {
    updatedSave: nextSave,
    outcome: damageOutcome,
    fateDamageRerollUsed,
    fateDamageRerollFrom,
  };
}
