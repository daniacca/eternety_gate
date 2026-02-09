import type { GameSave, WeaponId, Actor } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import type { IRNG } from "../../rng";
import { calculateWeaponDamage } from "../equipment";
import { getCharacteristicBonus } from "../../characters/bonuses";
import { getRangedDamageBonusFromMightyShot } from "../../characters/mightyShot";
import { appendRuntimeLog } from "../narration";
import { hasWeaponQuality } from "../../weaponQualities";

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
  rng: IRNG;
  catalogs?: CharacterCatalogs;
  resolutionId?: string;
  useFallbackWeapon: boolean;
  extraDice: number;
  rerollOnes: boolean;
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
    rng,
    catalogs,
    resolutionId,
    useFallbackWeapon,
    extraDice,
    rerollOnes,
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
    const hasTearing = hasWeaponQuality(weaponForQualities, "tearing");

    const damageCalc = calculateWeaponDamage(save, attacker, weaponId, rng, mode, rollsCount, catalogs, {
      tearing: hasTearing,
      extraDice,
      rerollOnes,
    });
    rawDamage = damageCalc.rawDamage;
    weaponName = damageCalc.weaponName;
    calculatedWeaponId = damageCalc.weaponId;

    if (extraDice > 0 && !accurateLogged) {
      nextSave = appendRuntimeLog(nextSave, {
        kind: "system",
        message: `Accurate: +${extraDice}d10 damage dice`,
        turnCounter: save.runtime.combat?.turnCounter ?? 0,
        resolutionId,
        tags: ["weapon:accurate", `extraDice=${extraDice}`],
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

      if (extraDice > 0) {
        formulaParts.push(`${extraDice}d10 (Accurate)`);
      }
      damageFormula = formulaParts.join(" + ");
    } else {
      const strBonus = getCharacteristicBonus(save, attacker.id, "STR", catalogs);
      const formulaParts: string[] = ["1d5"];
      if (strBonus > 0) {
        formulaParts.push(`${strBonus} (STR)`);
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
