import type { Actor, CombatAttackCheck, GameSave } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import type { IRNG } from "../../rng";
import { getActorArmor } from "../equipment";
import { appendRuntimeLog } from "../narration";
import { getCharacteristicBonus } from "../../characters/bonuses";
import { getModifierTotal } from "../../characters/modifiers";
import { hasTrait } from "../../characters/prerequisites";
import { hasNaturalWeapons, isNaturalWeaponId } from "../../characters/naturalWeapons";
import { getMagicPower } from "../../magic/pm";
import { getWeaponQualityRank, hasWeaponQuality } from "../../weaponQualities";
import { hasCondition } from "../../conditions";

export function computeDamageAfterReductions(params: {
  save: GameSave;
  updatedSave: GameSave;
  attacker: Actor;
  defender: Actor;
  check: CombatAttackCheck;
  rawDamage: number;
  damageFormula: string;
  calculatedWeaponId: string | "unarmed" | "improvised";
  useFallbackWeapon: boolean;
  isUnarmed: boolean;
  resultDos: number;
  mode: "MELEE" | "RANGED";
  damageOptions?: { bonusDamage?: number; bonusPenetration?: number };
  rng: IRNG;
  catalogs?: CharacterCatalogs;
  isMagicalSource: boolean;
  resolutionId?: string;
}): {
  updatedSave: GameSave;
  rawDamage: number;
  damageFormula: string;
  effectiveSoak: number;
  touBonus: number;
  finalDamage: number;
  weaponForPenetration: GameSave["weaponsById"][string] | null;
  isNaturalWeaponAttack: boolean;
  usesWarpWeapons: boolean;
  armorId?: string;
} {
  const {
    save,
    updatedSave,
    attacker,
    defender,
    check,
    rawDamage: baseRawDamage,
    damageFormula: baseFormula,
    calculatedWeaponId,
    useFallbackWeapon,
    isUnarmed,
    resultDos,
    mode,
    damageOptions,
    rng,
    catalogs,
    isMagicalSource,
    resolutionId,
  } = params;

  let nextSave = updatedSave;
  let rawDamage = baseRawDamage;
  let damageFormula = baseFormula;

  const bonusDamage = damageOptions?.bonusDamage ?? 0;
  const bonusPenetration = damageOptions?.bonusPenetration ?? 0;
  if (bonusDamage > 0) {
    rawDamage += bonusDamage;
    damageFormula = damageFormula ? `${damageFormula} + ${bonusDamage} (Vengeance)` : `${bonusDamage} (Vengeance)`;
  }
  if (mode === "MELEE" && hasCondition(attacker, "fiery_form")) {
    const fieryBonus = rng.nextInt(1, 10);
    rawDamage += fieryBonus;
    damageFormula = damageFormula
      ? `${damageFormula} + ${fieryBonus} (Fiery Form)`
      : `${fieryBonus} (Fiery Form)`;
  }

  const daemonicParams = defender.traits?.["trait:daemonic"];
  const baseDaemonic =
    typeof daemonicParams === "object" && typeof daemonicParams.x === "number" ? daemonicParams.x : 0;
  const cursedBonus =
    typeof defender.conditions?.cursed_earth?.params?.daemonicBonus === "number"
      ? defender.conditions?.cursed_earth?.params?.daemonicBonus
      : 0;
  const daemonicBonus = baseDaemonic + cursedBonus;
  const divineParams = defender.traits?.["trait:divine"];
  const divineBonus = typeof divineParams === "object" && typeof divineParams.x === "number" ? divineParams.x : 0;

  let { soak, armorId } = getActorArmor(save, defender);
  if (hasCondition(defender, "misfortune")) {
    soak = Math.ceil(soak / 2);
  }
  const machineSoak = catalogs ? getModifierTotal(save, catalogs, defender.id, "combat.machineSoak") : 0;
  const naturalArmorSoak = catalogs ? getModifierTotal(save, catalogs, defender.id, "combat.naturalArmor") : 0;

  const weaponForPenetration =
    calculatedWeaponId !== "unarmed" && !useFallbackWeapon ? save.weaponsById?.[calculatedWeaponId] : null;
  if (weaponForPenetration && hasWeaponQuality(weaponForPenetration, "sanctified") && daemonicBonus > 0) {
    const bonus = 2 * daemonicBonus;
    rawDamage += bonus;
    damageFormula = damageFormula ? `${damageFormula} + ${bonus} (Sanctified)` : `${bonus} (Sanctified)`;
  }
  if (weaponForPenetration && hasWeaponQuality(weaponForPenetration, "unholy") && divineBonus > 0) {
    const bonus = 2 * divineBonus;
    rawDamage += bonus;
    damageFormula = damageFormula ? `${damageFormula} + ${bonus} (Unholy)` : `${bonus} (Unholy)`;
  }
  if (hasCondition(defender, "sanctuary")) {
    if (weaponForPenetration && hasWeaponQuality(weaponForPenetration, "unholy")) {
      rawDamage = 0;
    } else {
      rawDamage = Math.ceil(rawDamage / 2);
    }
  }
  if (weaponForPenetration?.damageType === "energy" && hasCondition(defender, "fiery_form")) {
    rawDamage = Math.ceil(rawDamage / 2);
  }

  const isNaturalWeaponAttack =
    calculatedWeaponId !== "unarmed" && !useFallbackWeapon && isNaturalWeaponId(calculatedWeaponId);
  const usesWarpWeapons = hasTrait(attacker, "trait:warp_weapons", save) && (isUnarmed || isNaturalWeaponAttack);
  const forcePenBonus =
    weaponForPenetration && hasWeaponQuality(weaponForPenetration, "force") && hasTrait(attacker, "trait:weaver", save)
      ? getMagicPower(save, attacker.id, catalogs)
      : 0;
  const magicFueledPenBonus =
    weaponForPenetration &&
    hasWeaponQuality(weaponForPenetration, "magic_fueled") &&
    hasTrait(attacker, "trait:weaver", save)
      ? getMagicPower(save, attacker.id, catalogs)
      : 0;
  const razorSharpActive =
    weaponForPenetration && hasWeaponQuality(weaponForPenetration, "razor_sharp") && resultDos >= 3;
  const basePenetration = weaponForPenetration
    ? weaponForPenetration.penetration + forcePenBonus + magicFueledPenBonus + bonusPenetration
    : 0;
  const effectivePenetration = razorSharpActive ? basePenetration * 2 : basePenetration;

  let effectiveSoak = soak;
  if (usesWarpWeapons) {
    effectiveSoak = 0;
  } else if (isUnarmed || useFallbackWeapon) {
    const hasNaturalWeapon = hasNaturalWeapons(save, catalogs, attacker.id);
    if (!hasNaturalWeapon) {
      effectiveSoak = soak * 2;
    }
  } else if (weaponForPenetration) {
    effectiveSoak = Math.max(0, soak - effectivePenetration);
  }
  const defenderHasWeaver = hasTrait(defender, "trait:weaver", save);
  const effectiveNaturalArmorSoak = usesWarpWeapons && !defenderHasWeaver ? 0 : naturalArmorSoak;
  const extraSoak = machineSoak > 0 ? machineSoak : effectiveNaturalArmorSoak;
  if (extraSoak > 0) {
    effectiveSoak += extraSoak;
  }

  let touBonus = getCharacteristicBonus(save, defender.id, "TOU", catalogs);
  const fellingRank = weaponForPenetration ? getWeaponQualityRank(weaponForPenetration, "felling") : null;
  if (fellingRank && fellingRank > 0) {
    const reduced = Math.max(0, touBonus - fellingRank);
    if (reduced !== touBonus) {
      touBonus = reduced;
      nextSave = appendRuntimeLog(nextSave, {
        kind: "system",
        message: `Felling: Toughness Bonus reduced by ${fellingRank}`,
        turnCounter: save.runtime.combat?.turnCounter ?? 0,
        resolutionId,
        tags: ["weapon:felling", `reduction=${fellingRank}`],
      });
    }
  }
  if (isMagicalSource) {
    if (daemonicBonus > 0) {
      touBonus = Math.max(0, touBonus - daemonicBonus);
    }
  }
  if (weaponForPenetration && hasWeaponQuality(weaponForPenetration, "sanctified")) {
    const spiritualParams = defender.traits?.["trait:daemonic_spiritual"];
    const spiritualBonus =
      typeof spiritualParams === "object" && typeof spiritualParams.x === "number" ? spiritualParams.x : 0;
    if (spiritualBonus > 0) {
      touBonus = Math.max(0, touBonus - spiritualBonus);
    }
  }
  if (razorSharpActive) {
    nextSave = appendRuntimeLog(nextSave, {
      kind: "system",
      message: `Razor Sharp: penetration doubled to ${effectivePenetration}`,
      turnCounter: save.runtime.combat?.turnCounter ?? 0,
      resolutionId,
      tags: ["weapon:razor_sharp", `penetration=${effectivePenetration}`],
    });
  }

  let finalDamage = Math.max(0, rawDamage - effectiveSoak - touBonus);
  if (weaponForPenetration && hasWeaponQuality(weaponForPenetration, "magic_fueled")) {
    const mr = catalogs ? getModifierTotal(save, catalogs, defender.id, "magic.resistance") : 0;
    if (mr > 0) {
      finalDamage = Math.max(0, finalDamage - mr);
      nextSave = appendRuntimeLog(nextSave, {
        kind: "system",
        message: `Magic Resistance: -${mr} damage`,
        turnCounter: save.runtime.combat?.turnCounter ?? 0,
        resolutionId,
        tags: ["weapon:magic_fueled", `magicResistance=${mr}`],
      });
    }
  }

  const calledShotZone = check.modifiers?.calledShotZone;
  if (check.modifiers?.calledShot && calledShotZone === "head" && finalDamage > 0) {
    finalDamage = finalDamage * 2;
  }

  return {
    updatedSave: nextSave,
    rawDamage,
    damageFormula,
    effectiveSoak,
    touBonus,
    finalDamage,
    weaponForPenetration,
    isNaturalWeaponAttack,
    usesWarpWeapons,
    armorId,
  };
}
