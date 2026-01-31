import type { SingleCheck } from "../../../../types";
import { appendCombatLog, appendRuntimeLog } from "../../../narration";
import { applyDamageToActor } from "../../../criticalDamage";
import { trackCombatDamage } from "../../../damageTracking";
import { getActorArmor } from "../../../equipment";
import { getCharacteristicBonus } from "../../../../characters/bonuses";
import { calculateMaxHp } from "../../../../characters/hp";
import { hasCondition } from "../../../../conditions";
import { performCheckWithSave } from "../../../../checks";

import type { SpecialOpParams, SpecialOpResult } from "../types";

type RollMode = "best" | "worst" | "normal";

function getMagicRollMode(actor: { conditions?: Partial<Record<string, any>> } | undefined): RollMode {
  if (!actor) return "normal";
  const hasPrecognition = hasCondition(actor as any, "precognition");
  const hasMisfortune = hasCondition(actor as any, "misfortune");
  if (hasPrecognition && !hasMisfortune) return "best";
  if (hasMisfortune && !hasPrecognition) return "worst";
  return "normal";
}

export function resolveCombatHolocaust(params: SpecialOpParams): SpecialOpResult | null {
  const {
    save,
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell,
    effectDef,
    effectiveDoS,
    effectStatBonus,
    validTargetActors,
    getOvercastForTarget,
  } = params;
  if (effectDef.specialOp !== "combatHolocaust") {
    return null;
  }

  let updatedSave = save;
  const rollMode = getMagicRollMode(updatedSave.actorsById[turnActorId]);

  for (const target of validTargetActors) {
    if (target.actorId === turnActorId) {
      continue;
    }

    const targetOvercast = getOvercastForTarget(target.actorId);
    const diceCount = Math.max(0, effectStatBonus + targetOvercast);
    const rollDamageOnce = (): { rolls: number[]; total: number } => {
      const rolls: number[] = [];
      let total = 0;
      for (let i = 0; i < diceCount; i++) {
        const roll = rng.nextInt(1, 10);
        rolls.push(roll);
        total += roll;
      }
      return { rolls, total };
    };

    let damageRolls: number[] = [];
    let totalDamage = 0;
    if (diceCount > 0) {
      if (rollMode === "normal") {
        const rolled = rollDamageOnce();
        damageRolls = rolled.rolls;
        totalDamage = rolled.total;
      } else {
        const first = rollDamageOnce();
        const second = rollDamageOnce();
        const useSecond = rollMode === "best" ? second.total > first.total : second.total < first.total;
        const chosen = useSecond ? second : first;
        damageRolls = chosen.rolls;
        totalDamage = chosen.total;
      }
    }

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

    const formula = `${diceCount}d10`;
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
      tags: [
        `magic:spell=${spell.id}`,
        `magic:effect=${effectDef.id}`,
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
        `${spell.id}:holocaust`
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
  }

  const caster = updatedSave.actorsById[turnActorId];
  if (caster) {
    const backlashRoll = rng.nextInt(1, 10);
    const backlashDamage = Math.max(0, backlashRoll + effectStatBonus);
    const backlashResult = applyDamageToActor(caster, backlashDamage, updatedSave, rng, storyPack, catalogs);
    updatedSave = {
      ...updatedSave,
      actorsById: {
        ...updatedSave.actorsById,
        [turnActorId]: backlashResult.updatedActor,
      },
    };
    const casterName = caster.name || turnActorId;
    updatedSave = appendCombatLog(updatedSave, `${casterName} subisce il contraccolpo dell'olocausto (${backlashDamage} danni).`);
  }

  return { handled: true, save: updatedSave };
}
