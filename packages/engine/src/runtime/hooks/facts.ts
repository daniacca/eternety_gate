import type { Actor, CombatAttackCheck, GameSave, StoryPack } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import type { HookValue } from "./types";
import { getEquippedWeaponId } from "../characters/inventory";
import { footprintDistanceBetweenActors } from "../combat/footprint";
import { computeCombatModifiersFromConditions, getStacks, hasCondition } from "../conditions";
import { getCombatMasterPenalty, getFatiguePenaltyReduction, hasDeadeyeTalent, hasMarksmanTalent } from "../characters/talentModifiers";
import { hasTrait } from "../characters/prerequisites";
import { getUntouchableAuraImpact } from "../combat/untouchableAura";
import { getUntouchableAuraRadius, getUntouchableEffectiveWilBonus, isUntouchable } from "../characters/untouchable";
import { hasNaturalWeapons, isNaturalWeaponId } from "../characters/naturalWeapons";
import { getUnnaturalSenseRange, isActorBlind } from "../checks/combat/utils";
import { hasWeaponQuality } from "../weaponQualities";
import { getActorArmor } from "../combat/equipment";
import { getModifierTotal } from "../characters/modifiers";
import { getMagicPower } from "../magic/pm";
import { getWeaponQualityRank } from "../weaponQualities";
import { isFateProtectionActive } from "../characters/fate";
import { calculateMaxHp } from "../characters/hp";
import { getCombatDamageTracking } from "../combat/damageTracking";

function addConditionFacts(facts: Record<string, HookValue>, prefix: string, actor?: Actor): void {
  if (!actor?.conditions) return;
  for (const conditionId of Object.keys(actor.conditions)) {
    facts[`${prefix}.condition.${conditionId}`] = true;
  }
}

function addTraitFacts(facts: Record<string, HookValue>, prefix: string, actor?: Actor): void {
  if (!actor?.traits) return;
  for (const traitId of Object.keys(actor.traits)) {
    facts[`${prefix}.trait.${traitId}`] = true;
  }
}

function addTalentHookFacts(
  facts: Record<string, HookValue>,
  prefix: string,
  actor: Actor | undefined,
  catalogs?: CharacterCatalogs
): void {
  if (!actor || !catalogs) return;
  for (const [talentId, rank] of Object.entries(actor.talents ?? {})) {
    if (rank < 1) continue;
    const talent = catalogs.talents.find((entry) => entry.id === talentId);
    if (!talent) continue;
    for (const grant of talent.grants) {
      if (grant.type === "hook") {
        facts[`${prefix}.talentHook.${grant.hookId}`] = true;
      }
    }
  }
}

export function buildActorFacts(prefix: string, actor?: Actor, catalogs?: CharacterCatalogs): Record<string, HookValue> {
  const facts: Record<string, HookValue> = {};
  addConditionFacts(facts, prefix, actor);
  addTraitFacts(facts, prefix, actor);
  addTalentHookFacts(facts, prefix, actor, catalogs);
  return facts;
}

export function buildCombatCheckFacts(params: {
  check: CombatAttackCheck;
  attacker: Actor;
  defender: Actor;
  save: GameSave;
  storyPack?: StoryPack;
  catalogs?: CharacterCatalogs;
}): Record<string, HookValue> {
  const { check, attacker, defender, save, catalogs } = params;
  const facts: Record<string, HookValue> = {
    "check.kind": check.kind,
    "combat.mode": check.attacker.mode,
  };

  const combatDistance = footprintDistanceBetweenActors(save, attacker.id, defender.id);
  const isCloseRangeShot = check.attacker.mode === "RANGED" && check.modifiers?.closeRangeShot && combatDistance <= 1;
  const effectiveMode = isCloseRangeShot ? "MELEE" : check.attacker.mode;

  facts["combat.distance"] = combatDistance;
  facts["combat.closeRangeShot"] = isCloseRangeShot;
  facts["combat.effectiveMode"] = effectiveMode;
  facts["combat.rangeBand"] = check.modifiers?.rangeBand ?? null;
  facts["combat.cover"] = check.modifiers?.cover ?? null;
  facts["combat.calledShot"] = Boolean(check.modifiers?.calledShot);
  facts["combat.calledShotZone"] = check.modifiers?.calledShotZone ?? "body";
  facts["tag.combat.calledShotZone"] = `combat:mod:calledShotZone=${facts["combat.calledShotZone"]}`;
  facts["combat.outnumbering"] = check.modifiers?.outnumbering ?? 0;
  facts["combat.hitBonus"] = check.modifiers?.hitBonus ?? 0;
  if (check.modifiers?.hitBonus !== undefined && check.modifiers.hitBonus !== 0) {
    const sign = check.modifiers.hitBonus > 0 ? "+" : "";
    facts["tag.combat.hitBonus"] = `combat:mod:hitBonus=${sign}${check.modifiers.hitBonus}`;
  }

  Object.assign(facts, buildActorFacts("attacker", attacker, catalogs));
  Object.assign(facts, buildActorFacts("defender", defender, catalogs));

  if (hasCondition(attacker, "perfect_timing") && facts["combat.cover"] && facts["combat.cover"] !== "NONE") {
    facts["tag.combat.coverPerfectTiming"] = `combat:mod:cover:${facts["combat.cover"]}=+0 (Perfect Timing)`;
  }

  const attackerSenseRange = getUnnaturalSenseRange(attacker);
  const defenderSenseRange = getUnnaturalSenseRange(defender);
  facts["attacker.senseRange"] = attackerSenseRange;
  facts["defender.senseRange"] = defenderSenseRange;

  const attackerBlindActive = isActorBlind(attacker) && (attackerSenseRange <= 0 || combatDistance > attackerSenseRange);
  const defenderBlindActive = isActorBlind(defender) && (defenderSenseRange <= 0 || combatDistance > defenderSenseRange);
  facts["attacker.blindActive"] = attackerBlindActive;
  facts["defender.blindActive"] = defenderBlindActive;
  facts["combat.blindRangedBlocked"] = check.attacker.mode === "RANGED" && attackerBlindActive;
  const blindMeleeMod =
    effectiveMode === "MELEE" ? (attackerBlindActive ? -30 : 0) + (defenderBlindActive ? 30 : 0) : 0;
  facts["combat.blindMeleeModifier"] = blindMeleeMod;
  if (attackerBlindActive && effectiveMode === "MELEE") {
    facts["tag.combat.blindAttacker"] = "combat:mod:blind:melee=-30";
  }
  if (defenderBlindActive && effectiveMode === "MELEE") {
    facts["tag.combat.blindTarget"] = "combat:mod:blind:target=+30";
  }

  const fatiguePenaltyReduction = catalogs ? getFatiguePenaltyReduction(save, catalogs, attacker.id) : 0;
  const conditionModifiers = computeCombatModifiersFromConditions(attacker, fatiguePenaltyReduction);
  const fatiguePenalty = conditionModifiers.toHitPenalty ? -conditionModifiers.toHitPenalty : 0;
  facts["combat.fatiguePenalty"] = fatiguePenalty;
  if (conditionModifiers.toHitPenalty !== undefined && conditionModifiers.toHitPenalty > 0) {
    const suffix = fatiguePenaltyReduction > 0 ? " (Relentless)" : "";
    facts["tag.combat.fatigue"] = `combat:mod:fatigue=-${conditionModifiers.toHitPenalty}${suffix}`;
  }

  const defenderInvisibilityBonus =
    typeof defender.conditions?.invisibility?.params?.wilBonus === "number"
      ? defender.conditions?.invisibility?.params?.wilBonus
      : 0;
  if (defenderInvisibilityBonus > 0) {
    if (attackerSenseRange <= 0 || combatDistance > attackerSenseRange) {
      const invisPenalty = -5 * defenderInvisibilityBonus;
      facts["combat.invisibleTargetPenalty"] = invisPenalty;
      facts["tag.combat.invisibleTarget"] = `combat:mod:invisibleTarget=${invisPenalty}`;
    } else {
      facts["tag.combat.invisibleTarget"] = "combat:mod:invisibleTarget=0 (Unnatural Sense)";
    }
  } else {
    facts["combat.invisibleTargetPenalty"] = 0;
  }

  const attackerInvisibilityBonus =
    typeof attacker.conditions?.invisibility?.params?.wilBonus === "number"
      ? attacker.conditions?.invisibility?.params?.wilBonus
      : 0;
  if (attackerInvisibilityBonus > 0 && effectiveMode === "MELEE") {
    if (defenderSenseRange <= 0 || combatDistance > defenderSenseRange) {
      const invisBonus = 5 * attackerInvisibilityBonus;
      facts["combat.invisibleAttackerBonus"] = invisBonus;
      facts["tag.combat.invisibleAttacker"] = `combat:mod:invisibleAttacker=+${invisBonus}`;
    } else {
      facts["tag.combat.invisibleAttacker"] = "combat:mod:invisibleAttacker=+0 (Unnatural Sense)";
    }
  } else {
    facts["combat.invisibleAttackerBonus"] = 0;
  }

  const isDefenderProne = defender.conditions?.prone !== undefined;
  const isAttackerProne = attacker.conditions?.prone !== undefined;
  let proneMod = 0;
  if (isDefenderProne) {
    if (effectiveMode === "RANGED") {
      proneMod = -10;
      facts["tag.combat.prone"] = "combat:mod:prone:ranged=-10";
    } else if (effectiveMode === "MELEE" && !isAttackerProne) {
      proneMod = 20;
      facts["tag.combat.prone"] = "combat:mod:prone:melee=+20";
    }
  }
  facts["combat.proneModifier"] = proneMod;

  const defenderStance = save.runtime.combat?.stancesByActorId?.[defender.id];
  const defendPenalty = defenderStance === "defend" ? -20 : 0;
  facts["combat.defendPenalty"] = defendPenalty;

  const attackerWeaponId = check.attacker.weaponId ?? getEquippedWeaponId(attacker);
  const isAttackerUnarmed = !attackerWeaponId || attackerWeaponId === "unarmed";
  const defenderWeaponId = getEquippedWeaponId(defender);
  const defenderHasNaturalWeapons = catalogs ? hasNaturalWeapons(save, catalogs, defender.id) : false;
  const isDefenderArmed = (defenderWeaponId && defenderWeaponId !== "unarmed") || defenderHasNaturalWeapons;
  const unarmedPenalty = isAttackerUnarmed && isDefenderArmed ? -20 : 0;
  facts["combat.unarmedPenalty"] = unarmedPenalty;
  if (unarmedPenalty !== 0) {
    facts["tag.combat.unarmed"] = "combat:mod:unarmed=-20";
  }

  const sunburstWilBonus =
    typeof defender.conditions?.sunburst?.params?.wilBonus === "number"
      ? defender.conditions?.sunburst?.params?.wilBonus
      : 0;
  const sunburstPenalty = sunburstWilBonus > 0 && effectiveMode === "RANGED" ? -10 * sunburstWilBonus : 0;
  facts["combat.sunburstPenalty"] = sunburstPenalty;
  if (sunburstPenalty !== 0) {
    facts["tag.combat.sunburst"] = `combat:mod:sunburst=${sunburstPenalty}`;
  }

  const hasMarksman = catalogs ? hasMarksmanTalent(save, catalogs, attacker.id) : false;
  facts["attacker.marksman"] = hasMarksman;
  const hasDeadeye = catalogs ? hasDeadeyeTalent(save, catalogs, attacker.id) : false;
  facts["attacker.deadeye"] = hasDeadeye;

  const combatMasterPenalty = catalogs ? getCombatMasterPenalty(save, catalogs, defender.id) : 0;
  facts["combat.combatMasterPenalty"] = combatMasterPenalty;
  if (combatMasterPenalty !== 0) {
    facts["tag.combat.combatMaster"] = `combat:mod:combatMaster=${combatMasterPenalty}`;
  }

  const weapon = attackerWeaponId && attackerWeaponId !== "unarmed" ? save.weaponsById?.[attackerWeaponId] : null;
  const hasMagicFueled = hasWeaponQuality(weapon, "magic_fueled");
  const isWeaver = hasTrait(attacker, "trait:weaver", save);
  const magicFueledPenalty = hasMagicFueled && !isWeaver ? -10 : 0;
  facts["combat.magicFueledPenalty"] = magicFueledPenalty;
  if (magicFueledPenalty !== 0) {
    facts["tag.combat.magicFueled"] = "combat:mod:magicFueled=nonWeaver:-10";
  }

  const magicFueledAura = hasMagicFueled && catalogs ? getUntouchableAuraImpact(save, catalogs, attacker.id) : null;
  const magicFueledAuraPenalty = magicFueledAura ? magicFueledAura.penalty : 0;
  facts["combat.magicFueledAuraPenalty"] = magicFueledAuraPenalty;
  if (magicFueledAuraPenalty !== 0) {
    facts["tag.combat.magicFueledAura"] = `combat:mod:magicFueled:aura=${magicFueledAuraPenalty}`;
  }

  if (catalogs && isUntouchable(defender)) {
    const radius = getUntouchableAuraRadius(save, catalogs, defender.id);
    if (radius > 0) {
      const appliesToRanged = radius > 1;
      if (combatDistance <= radius && (appliesToRanged || effectiveMode === "MELEE")) {
        let mod = -20;
        facts["tag.combat.untouchable"] = "combat:mod:untouchable=-20";
        if (hasTrait(attacker, "trait:weaver", save)) {
          const wilBonus = getUntouchableEffectiveWilBonus(save, defender.id, catalogs);
          const extraPenalty = -(5 * wilBonus);
          if (extraPenalty !== 0) {
            mod += extraPenalty;
            facts["tag.combat.untouchableWeaver"] = `combat:mod:untouchable:weaver=${extraPenalty}`;
          }
        }
        facts["combat.untouchablePenalty"] = mod;
        facts["combat.untouchableApplies"] = true;
      }
    }
  }
  if (facts["combat.untouchableApplies"] !== true) {
    facts["combat.untouchableApplies"] = false;
    facts["combat.untouchablePenalty"] = 0;
  }

  const aimStance = save.runtime.combat?.stancesByActorId?.[attacker.id];
  if (effectiveMode === "RANGED" && aimStance === "aim") {
    const hasInaccurate = hasWeaponQuality(weapon, "inaccurate");
    const hasAccurate = hasWeaponQuality(weapon, "accurate");
    if (hasInaccurate) {
      facts["combat.aimBonus"] = 0;
      facts["tag.combat.aim"] = "combat:mod:aim=+0 (Inaccurate)";
    } else {
      let aimBonus = 20;
      facts["tag.combat.aim"] = "combat:mod:aim=+20";
      if (hasAccurate) {
        aimBonus += 10;
        facts["tag.combat.accurate"] = "combat:mod:accurate=+10";
      }
      facts["combat.aimBonus"] = aimBonus;
    }
  } else {
    facts["combat.aimBonus"] = 0;
  }

  const wordOfGod = defender.conditions?.word_of_god;
  if (wordOfGod?.params?.auraApplied) {
    const wilBonus = typeof wordOfGod.params?.wilBonus === "number" ? wordOfGod.params.wilBonus : 0;
    const overcast = typeof wordOfGod.params?.overcast === "number" ? wordOfGod.params.overcast : 0;
    facts["combat.wordOfGodActive"] = true;
    facts["combat.wordOfGodPenalty"] = -2 * wilBonus - 2 * overcast;
  } else {
    facts["combat.wordOfGodActive"] = false;
    facts["combat.wordOfGodPenalty"] = 0;
  }

  return facts;
}

export function buildPostCheckFacts(result: { roll: number; critical: string }): Record<string, HookValue> {
  const tens = Math.floor(result.roll / 10);
  const ones = result.roll % 10;
  return {
    "check.isDoubles": tens === ones && result.roll >= 11,
    "check.critical": result.critical,
  };
}

export function buildDamageFacts(params: {
  save: GameSave;
  attacker: Actor;
  defender: Actor;
  check: CombatAttackCheck;
  weaponForPenetration: GameSave["weaponsById"][string] | null;
  rawDamage: number;
  damageOptions?: { bonusDamage?: number; bonusPenetration?: number };
  catalogs?: CharacterCatalogs;
  isMagicalSource: boolean;
  resultDos: number;
  mode: "MELEE" | "RANGED";
  rng: { nextInt: (min: number, max: number) => number };
  isUnarmed: boolean;
  useFallbackWeapon: boolean;
  calculatedWeaponId: string | "unarmed" | "improvised";
}): Record<string, HookValue> {
  const {
    save,
    attacker,
    defender,
    check,
    weaponForPenetration,
    rawDamage,
    damageOptions,
    catalogs,
    isMagicalSource,
    resultDos,
    mode,
    rng,
    isUnarmed,
    useFallbackWeapon,
    calculatedWeaponId,
  } = params;

  const facts: Record<string, HookValue> = {
    "damage.rawDamage": rawDamage,
    "damage.bonusDamage": damageOptions?.bonusDamage ?? 0,
    "damage.bonusPenetration": damageOptions?.bonusPenetration ?? 0,
    "damage.isMagicalSource": isMagicalSource,
    "damage.calledShotHead": Boolean(check.modifiers?.calledShot && check.modifiers?.calledShotZone === "head"),
    "damage.isUnarmed": isUnarmed,
  };
  Object.assign(facts, buildActorFacts("attacker", attacker, catalogs));
  Object.assign(facts, buildActorFacts("defender", defender, catalogs));

  const fieryBonus = mode === "MELEE" && hasCondition(attacker, "fiery_form") ? rng.nextInt(1, 10) : 0;
  facts["damage.fieryBonus"] = fieryBonus;

  const daemonicParams = defender.traits?.["trait:daemonic"];
  const baseDaemonic =
    typeof daemonicParams === "object" && typeof daemonicParams.x === "number" ? daemonicParams.x : 0;
  const cursedBonus =
    typeof defender.conditions?.cursed_earth?.params?.daemonicBonus === "number"
      ? defender.conditions?.cursed_earth?.params?.daemonicBonus
      : 0;
  const daemonicBonus = baseDaemonic + cursedBonus;
  facts["damage.daemonicBonus"] = daemonicBonus;

  const divineParams = defender.traits?.["trait:divine"];
  const divineBonus = typeof divineParams === "object" && typeof divineParams.x === "number" ? divineParams.x : 0;
  facts["damage.divineBonus"] = divineBonus;

  const hasSanctified = hasWeaponQuality(weaponForPenetration, "sanctified");
  const hasUnholy = hasWeaponQuality(weaponForPenetration, "unholy");
  facts["damage.weapon.sanctified"] = hasSanctified;
  facts["damage.weapon.unholy"] = hasUnholy;
  const hasAccurate = hasWeaponQuality(weaponForPenetration, "accurate");
  facts["damage.weapon.accurate"] = hasAccurate;
  facts["damage.accurateExtraDice"] = hasAccurate ? Math.floor(resultDos / 2) : 0;
  facts["damage.sanctifiedBonus"] = hasSanctified && daemonicBonus > 0 ? 2 * daemonicBonus : 0;
  facts["damage.unholyBonus"] = hasUnholy && divineBonus > 0 ? 2 * divineBonus : 0;

  const sanctuaryActive = hasCondition(defender, "sanctuary");
  facts["damage.sanctuaryActive"] = sanctuaryActive;
  facts["damage.sanctuaryZero"] = sanctuaryActive && hasUnholy;
  facts["damage.sanctuaryHalf"] = sanctuaryActive && !hasUnholy;

  facts["damage.energyFieryHalf"] = weaponForPenetration?.damageType === "energy" && hasCondition(defender, "fiery_form");

  const { soak } = getActorArmor(save, defender);
  facts["damage.baseSoak"] = soak;
  facts["damage.misfortuneSoakHalf"] = hasCondition(defender, "misfortune");

  const machineSoak = catalogs ? getModifierTotal(save, catalogs, defender.id, "combat.machineSoak") : 0;
  const naturalArmorSoak = catalogs ? getModifierTotal(save, catalogs, defender.id, "combat.naturalArmor") : 0;
  const isNaturalWeaponAttack =
    calculatedWeaponId !== "unarmed" && !useFallbackWeapon && isNaturalWeaponId(calculatedWeaponId);
  const usesWarpWeapons = hasTrait(attacker, "trait:warp_weapons", save) && (isUnarmed || isNaturalWeaponAttack);
  const defenderHasWeaver = hasTrait(defender, "trait:weaver", save);
  const hasNaturalWeapon = catalogs ? hasNaturalWeapons(save, catalogs, attacker.id) : false;
  const effectiveNaturalArmorSoak = usesWarpWeapons && !defenderHasWeaver ? 0 : naturalArmorSoak;
  const extraSoak = machineSoak > 0 ? machineSoak : effectiveNaturalArmorSoak;
  facts["damage.extraSoak"] = extraSoak;
  facts["damage.usesWarpWeapons"] = usesWarpWeapons;
  facts["damage.unarmedSoakDouble"] = (isUnarmed || useFallbackWeapon) && !hasNaturalWeapon;

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
  facts["damage.forcePenBonus"] = forcePenBonus;
  facts["damage.magicFueledPenBonus"] = magicFueledPenBonus;
  const forceBonus =
    weaponForPenetration && hasWeaponQuality(weaponForPenetration, "force") && hasTrait(attacker, "trait:weaver", save)
      ? getMagicPower(save, attacker.id, catalogs)
      : 0;
  const magicFueledBonus =
    weaponForPenetration &&
    hasWeaponQuality(weaponForPenetration, "magic_fueled") &&
    hasTrait(attacker, "trait:weaver", save)
      ? getMagicPower(save, attacker.id, catalogs)
      : 0;
  facts["damage.forceBonus"] = forceBonus;
  facts["damage.magicFueledBonus"] = magicFueledBonus;

  const razorSharpActive =
    weaponForPenetration && hasWeaponQuality(weaponForPenetration, "razor_sharp") && resultDos >= 3;
  facts["damage.razorSharpActive"] = razorSharpActive;

  const fellingRank = weaponForPenetration ? getWeaponQualityRank(weaponForPenetration, "felling") : null;
  facts["damage.fellingRank"] = fellingRank ?? 0;
  facts["damage.fellingPenalty"] = fellingRank && fellingRank > 0 ? -fellingRank : 0;

  const spiritualParams = defender.traits?.["trait:daemonic_spiritual"];
  const spiritualBonus =
    typeof spiritualParams === "object" && typeof spiritualParams.x === "number" ? spiritualParams.x : 0;
  facts["damage.spiritualBonus"] = spiritualBonus;
  facts["damage.spiritualPenalty"] = hasSanctified && spiritualBonus > 0 ? -spiritualBonus : 0;

  const magicResistance =
    weaponForPenetration && hasWeaponQuality(weaponForPenetration, "magic_fueled") && catalogs
      ? getModifierTotal(save, catalogs, defender.id, "magic.resistance")
      : 0;
  facts["damage.magicResistance"] = magicResistance;
  facts["damage.magicResistancePenalty"] = magicResistance > 0 ? -magicResistance : 0;
  facts["damage.daemonicPenalty"] = isMagicalSource && daemonicBonus > 0 ? -daemonicBonus : 0;
  facts["damage.fateProtectionActive"] = isFateProtectionActive(attacker);

  return facts;
}

export function buildPostDamageFacts(params: {
  save: GameSave;
  attacker: Actor;
  defender: Actor;
  check: CombatAttackCheck;
  weaponForHitEffects: GameSave["weaponsById"][string] | null;
  isUnarmed: boolean;
  isNaturalWeaponAttack: boolean;
  didApplyDamage: boolean;
  resultDos: number;
  finalDamage: number;
  rng: { nextInt: (min: number, max: number) => number };
  storyPack?: StoryPack;
}): Record<string, HookValue> {
  const {
    save: _save,
    attacker,
    defender,
    check,
    weaponForHitEffects,
    isUnarmed,
    isNaturalWeaponAttack,
    didApplyDamage,
    resultDos,
    finalDamage,
    rng,
    storyPack,
  } = params;

  const facts: Record<string, HookValue> = {
    "damage.stage": "post",
    "damage.didApplyDamage": didApplyDamage,
    "damage.resultDos": resultDos,
    "damage.finalDamage": finalDamage,
  };

  // Called shot messages
  if (check.modifiers?.calledShot && didApplyDamage && check.modifiers.calledShotZone) {
    const zone = check.modifiers.calledShotZone;
    facts["damage.calledShotZone"] = zone;
    if (zone === "arms") {
      facts["log.calledShotArms"] =
        attacker.kind === "PC"
          ? `Il colpo al braccio disarma ${defender.name || "il bersaglio"}!`
          : `${attacker.name} disarma ${defender.name || "il bersaglio"} con un colpo al braccio!`;
    }
    if (zone === "legs") {
      facts["log.calledShotLegs"] =
        attacker.kind === "PC"
          ? `Il colpo alla gamba fa cadere ${defender.name || "il bersaglio"} a terra con movimento dimezzato!`
          : `${attacker.name} fa cadere ${defender.name || "il bersaglio"} a terra con movimento dimezzato!`;
    }
  }

  // Fire shield backlash
  const fireShield = defender.conditions?.fire_shield;
  if (fireShield && check.attacker.mode === "RANGED") {
    const wilBonus = typeof fireShield.params?.wilBonus === "number" ? fireShield.params.wilBonus : 0;
    const overcast = typeof fireShield.params?.overcast === "number" ? fireShield.params.overcast : 0;
    const backlashDamage = Math.max(0, wilBonus + overcast);
    facts["damage.fireShieldDamage"] = backlashDamage;
    if (backlashDamage > 0) {
      const attackerName = attacker.name || attacker.id;
      facts["log.fireShield"] = `${attackerName} viene colpito dal contraccolpo dello Scudo di Fuoco (${backlashDamage}).`;
    }
  }

  if (didApplyDamage && weaponForHitEffects) {
    const hasShocking = getWeaponQualityRank(weaponForHitEffects, "shocking") !== null;
    facts["damage.weapon.shocking"] = hasShocking;
    if (hasShocking) {
      const fatigueRoll = rng.nextInt(1, 5);
      const stunnedDuration = Math.ceil(resultDos / 2);
      facts["damage.shockingFatigue"] = fatigueRoll;
      facts["damage.shockingStunned"] = stunnedDuration;
      facts["log.shocking"] = `Shocking: fatigue ${fatigueRoll}, stunned ${stunnedDuration} rounds`;
    }

    const hasSanctified = getWeaponQualityRank(weaponForHitEffects, "sanctified") !== null;
    const hasUnholy = getWeaponQualityRank(weaponForHitEffects, "unholy") !== null;
    const hasInstability = defender.traits?.["trait:spiritual_instability"] !== undefined;
    const ignoreInstability = defender.conditions?.cursed_earth?.params?.ignoreInstability === true;
    const instabilityApplies = (hasSanctified || hasUnholy) && hasInstability && !ignoreInstability && Boolean(storyPack);
    facts["damage.instabilityApplies"] = instabilityApplies;
    if (instabilityApplies) {
      facts["damage.instabilityModifier"] = -10 - 5 * resultDos;
      facts["log.instabilitySuccess"] = `Sanctified: spiritual instability resisted`;
      facts["log.instabilityFailure"] = `Sanctified: spiritual instability triggered`;
      facts["log.instabilityDamage"] = `Sanctified: ${defender.id} suffers `;
    }
  }

  const toxicTraitParams = attacker.traits?.["trait:toxic"];
  const toxicTraitRank =
    typeof toxicTraitParams === "object" && typeof toxicTraitParams.x === "number" ? toxicTraitParams.x : 0;
  const weaponToxicRank = weaponForHitEffects ? getWeaponQualityRank(weaponForHitEffects, "toxic") : null;
  const toxicRank =
    weaponToxicRank ??
    (toxicTraitRank > 0 && (isUnarmed || isNaturalWeaponAttack) ? toxicTraitRank : null);
  const toxicApplies = didApplyDamage && toxicRank && toxicRank > 0 && Boolean(storyPack);
  facts["damage.toxicRank"] = toxicRank ?? 0;
  facts["damage.toxicApplies"] = toxicApplies;
  if (toxicApplies) {
    facts["damage.toxicModifier"] = -10 * (toxicRank ?? 0);
    facts["log.toxicSuccess"] = `Toxic: ${defender.id} resists (rank ${toxicRank})`;
    facts["log.toxicFailure"] = `Toxic: ${defender.id} fails (rank ${toxicRank})`;
    facts["log.toxicDamage"] = `Toxic: ${defender.id} suffers `;
  }

  return facts;
}

export function buildApplyDamageFacts(params: {
  save: GameSave;
  actor: Actor;
  damage: number;
  catalogs?: CharacterCatalogs;
}): Record<string, HookValue> {
  const { save, actor, damage, catalogs } = params;
  const maxHp = catalogs ? calculateMaxHp(save, actor, catalogs) : actor.derived?.hpMax ?? 100;
  const woundsBefore = actor.resources.wounds ?? 0;
  const normalizedWoundsBefore = Math.min(maxHp, woundsBefore);
  const hpBefore = maxHp - normalizedWoundsBefore;
  const projectedWoundsAfter = Math.min(maxHp, woundsBefore + damage);
  const projectedHpAfter = maxHp - projectedWoundsAfter;

  return {
    ...buildActorFacts("defender", actor, catalogs),
    "damage.amount": damage,
    "damage.hpBefore": hpBefore,
    "damage.projectedHpAfter": projectedHpAfter,
    "defender.fatePoints": actor.resources.fatePoints ?? 0,
    "defender.fateProtectionActive": isFateProtectionActive(actor),
  };
}

export function buildTurnStartFacts(params: {
  save: GameSave;
  actor: Actor;
  turnCounter: number;
  catalogs?: CharacterCatalogs;
}): Record<string, HookValue> {
  const { save, actor, turnCounter, catalogs } = params;
  const actorName = actor.name || actor.id;
  const stunnedCondition = actor.conditions?.stunned;
  const stunnedActive =
    stunnedCondition?.untilTurnCounter !== undefined && stunnedCondition.untilTurnCounter >= turnCounter;
  const boundCondition = actor.conditions?.bound;
  const boundActive = boundCondition?.untilTurnCounter !== undefined && boundCondition.untilTurnCounter >= turnCounter;
  const bleedingStacks = hasCondition(actor, "bleeding") ? getStacks(actor, "bleeding") : 0;
  const bleedingDamage = Math.max(1, bleedingStacks);
  const tracking = getCombatDamageTracking(save, actor.id);
  const auraImpact = catalogs ? getUntouchableAuraImpact(save, catalogs, actor.id) : null;
  const auraPenalty = auraImpact?.penalty ?? 0;

  return {
    ...buildActorFacts("defender", actor, catalogs),
    "turn.counter": turnCounter,
    "defender.isPlayer": actor.kind === "PC",
    "defender.condition.stunnedActive": stunnedActive,
    "defender.condition.boundActive": boundActive,
    "defender.condition.bleedingStacks": bleedingStacks,
    "damage.bleeding": bleedingDamage,
    "damageTracking.taken": tracking.taken,
    "damageTracking.dealt": tracking.dealt,
    "instability.auraPenalty": auraPenalty,
    "instability.checkId": `combat:spiritualInstability:${actor.id}:${turnCounter}`,
    "check.boundEscapeId": `combat:bound:escape:${actor.id}`,
    "tag.instabilityAura": auraImpact ? `aura:untouchable=${auraImpact.sourceId}` : null,
    "log.turnStartStunned":
      actor.kind === "PC"
        ? "Sei stordito e perdi il turno."
        : `${actorName} è stordito e perde il turno.`,
    "log.turnStartBoundEscape":
      actor.kind === "PC"
        ? "Riesci a liberarti dai legami!"
        : `${actorName} riesce a liberarsi dai legami!`,
    "log.turnStartBoundFail":
      actor.kind === "PC"
        ? "Sei legato e non puoi muoverti."
        : `${actorName} è legato e non può muoversi.`,
    "log.turnStartBleeding":
      actor.kind === "PC"
        ? `Sanguini e perdi ${bleedingDamage} HP.`
        : `${actorName} sanguina e perde ${bleedingDamage} HP.`,
    "log.instabilityDamage":
      actor.kind === "PC"
        ? "La tua instabilita spirituale ti infligge "
        : `${actorName} subisce `,
    "log.instabilityRuntime": `Spiritual Instability: ${actor.id} suffers `,
  };
}
