import type { GameSave, WeaponId, Actor, CheckResult } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import type { IRNG } from "../../rng";
import { calculateWeaponDamage } from "../equipment";
import { getCharacteristicBonus } from "../../characters/bonuses";
import { getRangedDamageBonusFromMightyShot } from "../../characters/mightyShot";
import { appendRuntimeLog } from "../narration";
import { getMagicPower } from "../../magic/pm";
import { hasWeaponQuality } from "../../weaponQualities";
import { hasTrait } from "../../characters/prerequisites";

export type DamageRollOutcome = {
  rawDamage: number;
  weaponName: string;
  calculatedWeaponId: WeaponId | "unarmed" | "improvised";
  damageRolls: number[];
  damageFormula: string;
};

export type DamageRollContext = {
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
};

export function rollWeaponDamage(
  context: DamageRollContext,
  accurateLogged: boolean,
): { outcome: DamageRollOutcome; updatedSave: GameSave; accurateLogged: boolean } {
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
  } = context;

  let nextSave = updatedSave;
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

    const formulaParts: string[] = ["1d5"];
    if (strBonus > 0) {
      formulaParts.push(`${strBonus} (STR)`);
    }
    damageFormula = formulaParts.join(" + ");
  } else {
    const weaponForQualities = weaponId && weaponId !== "unarmed" ? save.weaponsById?.[weaponId] : null;
    const hasAccurate = hasWeaponQuality(weaponForQualities, "accurate");
    const hasMagicFueled = hasWeaponQuality(weaponForQualities, "magic_fueled");
    const accurateExtraDice = hasAccurate ? Math.floor(result.dos / 2) : 0;
    const hasTearing = hasWeaponQuality(weaponForQualities, "tearing");
    const forceBonus =
      hasWeaponQuality(weaponForQualities, "force") && hasTrait(attacker, "trait:weaver", save)
        ? getMagicPower(save, attacker.id, catalogs)
        : 0;
    const magicFueledBonus =
      hasMagicFueled && hasTrait(attacker, "trait:weaver", save) ? getMagicPower(save, attacker.id, catalogs) : 0;

    const damageCalc = calculateWeaponDamage(save, attacker, weaponId, rng, mode, rollsCount, catalogs, {
      tearing: hasTearing,
      extraDice: accurateExtraDice,
      rerollOnes: isUnarmed && hasUnarmedSpecialist,
    });
    rawDamage = damageCalc.rawDamage;
    if (forceBonus > 0) {
      rawDamage += forceBonus;
    }
    if (magicFueledBonus > 0) {
      rawDamage += magicFueledBonus;
    }
    weaponName = damageCalc.weaponName;
    calculatedWeaponId = damageCalc.weaponId;

    if (accurateExtraDice > 0 && !accurateLogged) {
      nextSave = appendRuntimeLog(nextSave, {
        kind: "system",
        message: `Accurate: +${accurateExtraDice}d10 damage dice`,
        turnCounter: save.runtime.combat?.turnCounter ?? 0,
        resolutionId,
        tags: ["weapon:accurate", `extraDice=${accurateExtraDice}`],
      });
      accurateLogged = true;
    }

    const weapon = calculatedWeaponId !== "unarmed" ? save.weaponsById?.[calculatedWeaponId] : null;
    if (weapon) {
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

      const formulaParts: string[] = [diceNotation];
      if (weapon.damage.add > 0) {
        formulaParts.push(`${weapon.damage.add} (weapon)`);
      }

      if (mode === "MELEE") {
        const strBonus = getCharacteristicBonus(save, attacker.id, "STR", catalogs);
        if (strBonus > 0) {
          formulaParts.push(`${strBonus} (STR)`);
        }
      } else if (mode === "RANGED") {
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

  return {
    outcome: { rawDamage, weaponName, calculatedWeaponId, damageRolls, damageFormula },
    updatedSave: nextSave,
    accurateLogged,
  };
}
