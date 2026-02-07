import type { Actor, Effect, GameSave, SingleCheck, StoryPack } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import type { IRNG } from "../../rng";
import { appendRuntimeLog } from "../narration";
import { applyDamageToActor } from "../criticalDamage";
import { performCheckWithSave } from "../../checks";
import { getWeaponQualityRank, hasWeaponQuality } from "../../weaponQualities";

export function applyWeaponOnHitEffects(params: {
  save: GameSave;
  attacker: Actor;
  defender: Actor;
  weaponForHitEffects: GameSave["weaponsById"][string] | null;
  isUnarmed: boolean;
  isNaturalWeaponAttack: boolean;
  didApplyDamage: boolean;
  resultDos: number;
  rng: IRNG;
  storyPack?: StoryPack;
  catalogs?: CharacterCatalogs;
  resolutionId?: string;
}): { save: GameSave; effects: Effect[]; actorDied?: boolean } {
  const {
    save,
    attacker,
    defender,
    weaponForHitEffects,
    isUnarmed,
    isNaturalWeaponAttack,
    didApplyDamage,
    resultDos,
    rng,
    storyPack,
    catalogs,
    resolutionId,
  } = params;

  let updatedSave = save;
  const emittedEffects: Effect[] = [];
  let actorDied = false;

  if (didApplyDamage && weaponForHitEffects) {
    if (hasWeaponQuality(weaponForHitEffects, "shocking")) {
      const fatigueRoll = rng.nextInt(1, 5);
      const stunnedDuration = Math.ceil(resultDos / 2);
      emittedEffects.push({
        op: "addCondition",
        actorId: defender.id,
        condition: "fatigue",
        stacks: fatigueRoll,
        source: "weapon:shocking",
      });
      if (stunnedDuration > 0) {
        emittedEffects.push({
          op: "addCondition",
          actorId: defender.id,
          condition: "stunned",
          durationTurns: stunnedDuration,
          source: "weapon:shocking",
        });
      }
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "system",
        message: `Shocking: fatigue ${fatigueRoll}, stunned ${stunnedDuration} rounds`,
        turnCounter: save.runtime.combat?.turnCounter ?? 0,
        resolutionId,
        tags: ["weapon:shocking", `fatigue=${fatigueRoll}`, `stunned=${stunnedDuration}`],
      });
    }

    const hasSanctified = hasWeaponQuality(weaponForHitEffects, "sanctified");
    const hasUnholy = hasWeaponQuality(weaponForHitEffects, "unholy");
    if ((hasSanctified || hasUnholy) && storyPack) {
      const hasInstability = defender.traits?.["trait:spiritual_instability"] !== undefined;
      const ignoreInstability = defender.conditions?.cursed_earth?.params?.ignoreInstability === true;
      if (hasInstability && !ignoreInstability) {
        const penalty = -10 - 5 * resultDos;
        const instabilityCheck: SingleCheck = {
          id: `combat:sanctified:instability:${defender.id}`,
          kind: "single",
          actorRef: { mode: "byId", actorId: defender.id },
          key: "WIL",
          difficulty: "Challenging",
          modifier: penalty,
        };
        const { result: instabilityResult, save: saveAfterCheck } = performCheckWithSave(
          instabilityCheck,
          storyPack,
          updatedSave,
          rng,
          resolutionId ? `${resolutionId}:sanctified` : undefined,
        );
        updatedSave = {
          ...saveAfterCheck,
          runtime: {
            ...saveAfterCheck.runtime,
            rngCounter: rng.getCounter(),
          },
        };
        updatedSave = appendRuntimeLog(updatedSave, {
          kind: "system",
          message: `Sanctified: spiritual instability ${instabilityResult?.success ? "resisted" : "triggered"}`,
          turnCounter: save.runtime.combat?.turnCounter ?? 0,
          resolutionId,
          tags: ["weapon:sanctified", `success=${instabilityResult?.success ? 1 : 0}`, `penalty=${penalty}`],
        });

        if (instabilityResult && !instabilityResult.success) {
          const backlashDamage = 1 + instabilityResult.dof;
          const currentDefender = updatedSave.actorsById[defender.id] ?? defender;
          const instabilityDamageResult = applyDamageToActor(currentDefender, backlashDamage, updatedSave, rng, storyPack, catalogs);
          const instabilityDefender = instabilityDamageResult.updatedActor;
          if (instabilityDamageResult.actorDied) {
            actorDied = true;
          }
          updatedSave = {
            ...updatedSave,
            actorsById: {
              ...updatedSave.actorsById,
              [defender.id]: instabilityDefender,
            },
            runtime: {
              ...updatedSave.runtime,
              rngCounter: rng.getCounter(),
            },
          };
          if (instabilityDamageResult.effects.length > 0) {
            emittedEffects.push(...instabilityDamageResult.effects);
          }
          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "system",
            message: `Sanctified: ${defender.id} suffers ${backlashDamage} instability damage`,
            turnCounter: save.runtime.combat?.turnCounter ?? 0,
            resolutionId,
            tags: ["weapon:sanctified", "spirit:instability", `damage=${backlashDamage}`],
          });
        }
      }
    }
  }

  const toxicTraitParams = attacker.traits?.["trait:toxic"];
  const toxicTraitRank =
    typeof toxicTraitParams === "object" && typeof toxicTraitParams.x === "number" ? toxicTraitParams.x : 0;
  const weaponToxicRank = weaponForHitEffects ? getWeaponQualityRank(weaponForHitEffects, "toxic") : null;
  const toxicRank =
    weaponToxicRank ??
    (toxicTraitRank > 0 && (isUnarmed || isNaturalWeaponAttack) ? toxicTraitRank : null);
  if (didApplyDamage && toxicRank && toxicRank > 0 && storyPack) {
    const toxicCheck: SingleCheck = {
      id: `combat:toxic:${attacker.id}:${defender.id}`,
      kind: "single",
      actorRef: { mode: "byId", actorId: defender.id },
      key: "TOU",
      difficulty: "Challenging",
      modifier: -10 * toxicRank,
    };
    const { result: toxicResult, save: saveAfterToxicCheck } = performCheckWithSave(
      toxicCheck,
      storyPack,
      updatedSave,
      rng,
      resolutionId ? `${resolutionId}:toxic` : undefined,
    );
    updatedSave = {
      ...saveAfterToxicCheck,
      runtime: {
        ...saveAfterToxicCheck.runtime,
        rngCounter: rng.getCounter(),
      },
    };
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Toxic: ${defender.id} ${toxicResult?.success ? "resists" : "fails"} (rank ${toxicRank})`,
      turnCounter: save.runtime.combat?.turnCounter ?? 0,
      resolutionId,
      tags: ["weapon:toxic", `rank=${toxicRank}`, `success=${toxicResult?.success ? 1 : 0}`],
    });

    if (!toxicResult?.success) {
      const directDamage = rng.nextInt(1, 10);
      const currentDefender = updatedSave.actorsById[defender.id] ?? defender;
      const toxicDamageResult = applyDamageToActor(currentDefender, directDamage, updatedSave, rng, storyPack, catalogs);
      const toxicDefender = toxicDamageResult.updatedActor;
      if (toxicDamageResult.actorDied) {
        actorDied = true;
      }
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [defender.id]: toxicDefender,
        },
        runtime: {
          ...updatedSave.runtime,
          rngCounter: rng.getCounter(),
        },
      };
      if (toxicDamageResult.effects.length > 0) {
        emittedEffects.push(...toxicDamageResult.effects);
      }
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "system",
        message: `Toxic: ${defender.id} suffers ${directDamage} direct damage`,
        turnCounter: save.runtime.combat?.turnCounter ?? 0,
        resolutionId,
        tags: ["weapon:toxic", `damage=${directDamage}`, "direct=1"],
      });
    }
  }

  return {
    save: updatedSave,
    effects: emittedEffects,
    actorDied,
  };
}
