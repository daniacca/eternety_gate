import type { GameSave, SingleCheck } from "../../../types";
import { appendCombatLog, appendRuntimeLog } from "../../narration";
import { resolveForceFieldBlock } from "../../forceField";
import { applyDamageToActor } from "../../criticalDamage";
import { trackCombatDamage } from "../../damageTracking";
import { getActorArmor } from "../../equipment";
import { getCharacteristicBonus } from "../../../characters/bonuses";
import { calculateMaxHp } from "../../../characters/hp";
import { scaleDamage, scaleHeal } from "../../../magic/scaling";
import { hasCondition } from "../../../conditions";
import { performCheckWithSave } from "../../../checks";

import type { SpellDamageParams } from "./types";

export function applySpellDamageAndHealing(params: SpellDamageParams): GameSave {
  const {
    save,
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell,
    effectDef,
    cnBase,
    effectiveDoS,
    resolutionId,
    effectStatBonus,
    validTargetActors,
    getOvercastForTarget,
  } = params;

  let updatedSave = save;
  let remainingTargets = [...validTargetActors];

  const shouldCheckForceField =
    effectDef.kind === "damage" || effectDef.kind === "fatigue" || effectDef.kind === "malediction";
  if (shouldCheckForceField && remainingTargets.length > 0) {
    const filtered: typeof remainingTargets = [];
    for (const target of remainingTargets) {
      const forceFieldResult = resolveForceFieldBlock(updatedSave, target.actor, rng, combat.turnCounter, catalogs);
      updatedSave = forceFieldResult.save;

      if (forceFieldResult.blocked) {
        const targetName = target.actor.name || target.actorId;
        const overloadText = forceFieldResult.overloaded
          ? ` Un lampo accecante esplode, scariche eldritiche avvolgono l'aria e il bagliore si spegne per ${
              forceFieldResult.overloadDuration ?? 0
            } turni.`
          : "";
        const fatigueText = forceFieldResult.fatigue ? ` (${forceFieldResult.fatigue} Fatigue)` : "";
        const blockLog = `${targetName}: il Campo di Forza si illumina e annulla l'attacco.${overloadText}${fatigueText}`;
        updatedSave = appendCombatLog(updatedSave, blockLog);
        continue;
      }

      filtered.push(target);
    }
    remainingTargets = filtered;
  }

  if (effectDef.baseDamageDice && effectDef.kind !== "fatigue" && remainingTargets.length > 0) {
    const baseDice = effectDef.baseDamageDice;
    const diceCount = baseDice?.dice ?? 0;
    const diceSides = baseDice?.sides ?? 10;
    const rollMode = params.getMagicRollMode(updatedSave.actorsById[turnActorId]);
    const rollDamageOnce = (): { rolls: number[]; total: number } => {
      const rolls: number[] = [];
      let total = 0;
      for (let i = 0; i < diceCount; i++) {
        const roll = rng.nextInt(1, diceSides);
        rolls.push(roll);
        total += roll;
      }
      return { rolls, total };
    };
    let damageRolls: number[] = [];
    let diceTotal = 0;
    if (rollMode === "normal") {
      const rolled = rollDamageOnce();
      damageRolls = rolled.rolls;
      diceTotal = rolled.total;
    } else {
      const first = rollDamageOnce();
      const second = rollDamageOnce();
      const useSecond = rollMode === "best" ? second.total > first.total : second.total < first.total;
      const chosen = useSecond ? second : first;
      damageRolls = chosen.rolls;
      diceTotal = chosen.total;
    }

    for (const target of remainingTargets) {
      const targetOvercast = getOvercastForTarget(target.actorId);
      const baseDamageFlat = (effectDef.baseDamageFlat ?? 0) + effectStatBonus;
      const scaled = scaleDamage(effectDef.baseDamageDice, baseDamageFlat, targetOvercast);
      let totalDamage = diceTotal + scaled.flatPlus;
      const damageQualities = effectDef.damageQualities ?? [];
      if (effectDef.kind === "damage") {
        const daemonicParams = target.actor.traits?.["trait:daemonic"];
        const baseDaemonic =
          typeof daemonicParams === "object" && typeof daemonicParams.x === "number" ? daemonicParams.x : 0;
        const cursedBonus =
          typeof target.actor.conditions?.cursed_earth?.params?.daemonicBonus === "number"
            ? target.actor.conditions?.cursed_earth?.params?.daemonicBonus
            : 0;
        const daemonicBonus = baseDaemonic + cursedBonus;
        const divineParams = target.actor.traits?.["trait:divine"];
        const divineBonus = typeof divineParams === "object" && typeof divineParams.x === "number" ? divineParams.x : 0;

        if (damageQualities.includes("sanctified") && daemonicBonus > 0) {
          totalDamage += 2 * daemonicBonus;
        }
        if (damageQualities.includes("unholy") && divineBonus > 0) {
          totalDamage += 2 * divineBonus;
        }
        if (hasCondition(target.actor, "sanctuary")) {
          if (damageQualities.includes("unholy")) {
            totalDamage = 0;
          } else {
            totalDamage = Math.ceil(totalDamage / 2);
          }
        }
        if (effectDef.damageType === "energy" && hasCondition(target.actor, "fiery_form")) {
          totalDamage = Math.ceil(totalDamage / 2);
        }
      }

      if (effectDef.kind === "heal") {
        const woundsBefore = target.actor.resources.wounds ?? 0;
        const healedAmount = scaleHeal(totalDamage, targetOvercast);
        const woundsAfter = Math.max(0, woundsBefore - healedAmount);
        const healed = woundsBefore - woundsAfter;

        const updatedTargetActor = {
          ...target.actor,
          resources: {
            ...target.actor.resources,
            wounds: woundsAfter,
          },
        };

        updatedSave = {
          ...updatedSave,
          actorsById: {
            ...updatedSave.actorsById,
            [target.actorId]: updatedTargetActor,
          },
        };

        const formula = `${scaled.diceCount}d${scaled.diceSides}${scaled.flatPlus > 0 ? ` + ${scaled.flatPlus}` : ""}${
          targetOvercast > 0 ? ` (overcast +${targetOvercast * 2})` : ""
        }`;
        updatedSave = appendRuntimeLog(updatedSave, {
          kind: "damage",
          attackerId: turnActorId,
          defenderId: target.actorId,
          formula,
          rolls: damageRolls,
          rawDamage: totalDamage,
          soak: 0,
          finalDamage: -healed,
          turnCounter: combat.turnCounter,
          resolutionId,
          tags: [
            `magic:spell=${spell.id}`,
            `magic:effect=${effectDef.id}`,
            `magic:cn=${cnBase}`,
            `magic:dosTotal=${effectiveDoS}`,
            `magic:overcast=${targetOvercast}`,
            `magic:kind=${effectDef.kind}`,
          ],
        });

        if (
          storyPack &&
          (damageQualities.includes("sanctified") || damageQualities.includes("unholy")) &&
          target.actor.traits?.["trait:spiritual_instability"] !== undefined &&
          !target.actor.conditions?.cursed_earth?.params?.ignoreInstability
        ) {
          const penalty = -10 - 5 * effectiveDoS;
          const instabilityCheck: SingleCheck = {
            id: `combat:spell:instability:${spell.id}:${target.actorId}`,
            kind: "single",
            actorRef: { mode: "byId", actorId: target.actorId },
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
          updatedSave = saveAfterCheck;
          if (instabilityResult && !instabilityResult.success) {
            const backlashDamage = 1 + instabilityResult.dof;
            const currentDefender = updatedSave.actorsById[target.actorId] ?? target.actor;
            const instabilityDamageResult = applyDamageToActor(
              currentDefender,
              backlashDamage,
              updatedSave,
              rng,
              storyPack,
              catalogs
            );
            updatedSave = {
              ...updatedSave,
              actorsById: {
                ...updatedSave.actorsById,
                [target.actorId]: instabilityDamageResult.updatedActor,
              },
            };
          }
        }

        const targetName = target.actor.name || target.actorId;
        const maxHpActual = catalogs ? calculateMaxHp(updatedSave, target.actor, catalogs) : target.actor.derived?.hpMax ?? 100;
        const hpBefore = maxHpActual - woundsBefore;
        const hpAfter = maxHpActual - woundsAfter;
        const healLog = `${targetName} recupera ${healed} HP (HP: ${hpBefore}→${hpAfter})`;
        updatedSave = appendCombatLog(updatedSave, healLog);

        if (effectDef.healFatigueRatio && healed > 0) {
          const fatigueAmount = Math.ceil(healed * effectDef.healFatigueRatio);
          if (fatigueAmount > 0) {
            updatedSave = params.applyFatigue(updatedSave, turnActorId, fatigueAmount, catalogs);
            const casterName = updatedSave.actorsById[turnActorId]?.name || turnActorId;
            updatedSave = appendCombatLog(
              updatedSave,
              `${casterName} accumula ${fatigueAmount} Fatigue (tassazione della cura).`
            );
          }
        }
      } else {
        const baseTouBonus = getCharacteristicBonus(updatedSave, target.actorId, "TOU", catalogs);
        let effectiveTouBonus = baseTouBonus;
        if (effectDef.damageType !== "impact") {
          const daemonicParams = target.actor.traits?.["trait:daemonic"];
          const baseDaemonic =
            typeof daemonicParams === "object" && typeof daemonicParams.x === "number" ? daemonicParams.x : 0;
          const cursedBonus =
            typeof target.actor.conditions?.cursed_earth?.params?.daemonicBonus === "number"
              ? target.actor.conditions?.cursed_earth?.params?.daemonicBonus
              : 0;
          effectiveTouBonus = Math.max(0, baseTouBonus - (baseDaemonic + cursedBonus));
        }
        let armorSoak = effectDef.damageType === "impact" ? getActorArmor(updatedSave, target.actor).soak : 0;
        if (armorSoak > 0 && hasCondition(target.actor, "misfortune")) {
          armorSoak = Math.ceil(armorSoak / 2);
        }
        const finalDamage = Math.max(0, totalDamage - effectiveTouBonus - armorSoak);

        const damageResult = applyDamageToActor(target.actor, finalDamage, updatedSave, rng, storyPack, catalogs);
        updatedSave = {
          ...updatedSave,
          actorsById: {
            ...updatedSave.actorsById,
            [target.actorId]: damageResult.updatedActor,
          },
        };
        if (!damageResult.dieHardUsed && finalDamage > 0) {
          updatedSave = trackCombatDamage(updatedSave, turnActorId, target.actorId, finalDamage);
        }

        const formula = `${scaled.diceCount}d${scaled.diceSides}${scaled.flatPlus > 0 ? ` + ${scaled.flatPlus}` : ""}${
          targetOvercast > 0 ? ` (overcast +${targetOvercast * 2})` : ""
        }`;
        updatedSave = appendRuntimeLog(updatedSave, {
          kind: "damage",
          attackerId: turnActorId,
          defenderId: target.actorId,
          formula,
          rolls: damageRolls,
          rawDamage: totalDamage,
          soak: armorSoak,
          touBonus: effectiveTouBonus,
          finalDamage,
          turnCounter: combat.turnCounter,
          resolutionId,
          tags: [
            `magic:spell=${spell.id}`,
            `magic:effect=${effectDef.id}`,
            `magic:cn=${cnBase}`,
            `magic:dosTotal=${effectiveDoS}`,
            `magic:overcast=${targetOvercast}`,
            `magic:kind=${effectDef.kind}`,
          ],
        });

        const targetName = target.actor.name || target.actorId;
        const maxHpActual = catalogs ? calculateMaxHp(updatedSave, target.actor, catalogs) : target.actor.derived?.hpMax ?? 100;
        const woundsBefore = target.actor.resources.wounds ?? 0;
        const woundsAfter = damageResult.updatedActor.resources.wounds ?? 0;
        const hpBefore = maxHpActual - woundsBefore;
        const hpAfter = maxHpActual - woundsAfter;
        updatedSave = appendCombatLog(updatedSave, `${targetName} subisce ${finalDamage} danni (HP: ${hpBefore}→${hpAfter})`);
      }
    }
  }

  return updatedSave;
}
