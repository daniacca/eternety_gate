import type { GameSave } from "../../../types";
import { appendCombatLog, appendRuntimeLog } from "../../narration";
import { applyFatigue } from "../../../characters/fatigue";
import { getActorSize, canPlaceActorAt } from "../../footprint";
import { getCellTerrain } from "../../terrain";
import { getActorArmor } from "../../equipment";
import { getCharacteristicBonus } from "../../../characters/bonuses";
import { applyDamageToActor } from "../../criticalDamage";
import { trackCombatDamage } from "../../damageTracking";
import { updateAuraEffects, calculateInitialMovement } from "../../combat";
import { hasCondition, addConditionToActor } from "../../../conditions";
import {
  addUnnaturalCharacteristics,
  addTraitsWithSource,
  getSteelBodyCharacteristics,
  getWarpSpeedCharacteristics,
  removeUnnaturalCharacteristicsBySource,
} from "../../../characters/traitHelpers";
import { scaleCondition } from "../../../magic/scaling";

import type { SpellConditionParams } from "./types";

export function applySpellConditionsAndMovement(params: SpellConditionParams): GameSave {
  const {
    save,
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell,
    effectDef,
    resolutionId,
    effectStatBonus,
    validTargetActors,
    getOvercastForTarget,
    terrainContentPack,
    getMagicRollMode,
    effectiveDoS,
  } = params;

  let updatedSave = save;

  // Apply fatigue effects (for mentis_disrupt)
  if (effectDef.kind === "fatigue" && validTargetActors.length > 0) {
    for (const target of validTargetActors) {
      let totalFatigue = 0;
      const targetOvercast = getOvercastForTarget(target.actorId);

      // Use applyFatigueDice if present
      if (effectDef.applyFatigueDice) {
        // Roll fatigue dice
        for (let i = 0; i < effectDef.applyFatigueDice.dice; i++) {
          const roll = rng.nextInt(1, effectDef.applyFatigueDice.sides);
          totalFatigue += roll;
        }

        // Scale with overcast
        totalFatigue += targetOvercast;

        // Apply fatigue
        updatedSave = applyFatigue(updatedSave, target.actorId, totalFatigue, catalogs);

        const targetName = target.actor.name || target.actorId;
        const fatigueLog = `${targetName} subisce ${totalFatigue} Fatigue (${effectDef.applyFatigueDice.dice}d${
          effectDef.applyFatigueDice.sides
        }${targetOvercast > 0 ? ` + ${targetOvercast} overcast` : ""})`;
        updatedSave = appendCombatLog(updatedSave, fatigueLog);

        // Log fatigue application (tags are in combat log, not runtime log)
        // Runtime log doesn't support tags, so we just log the message
        updatedSave = appendRuntimeLog(updatedSave, {
          kind: "system",
          message: `${targetName} subisce ${totalFatigue} Fatigue (spell: ${spell.id}, kind: ${effectDef.kind})`,
          turnCounter: combat.turnCounter,
          resolutionId,
        });
      }
    }
  }

  // Apply temp modifiers with duration (for mentis_sensory_distortion, vates_premonition)
  if (effectDef.tempModifier && validTargetActors.length > 0) {
    for (const target of validTargetActors) {
      const targetOvercast = getOvercastForTarget(target.actorId);
      const baseDuration =
        effectDef.tempModifier.fixedDurationRounds ?? effectDef.tempModifier.durationRounds + effectStatBonus;
      const scaledDuration = baseDuration + targetOvercast;
      const untilTurnCounter = combat.turnCounter + scaledDuration;
      const modifierId = `spell:${spell.id}:${target.actorId}`;

      // Remove existing modifier with same id to prevent stacking
      const existingModifiers = (target.actor.status.tempModifiers || []).filter((mod) => mod.id !== modifierId);

      const updatedTargetActor = {
        ...target.actor,
        status: {
          ...target.actor.status,
          tempModifiers: [
            ...existingModifiers,
            {
              id: modifierId,
              scope: effectDef.tempModifier.scope,
              key: null, // Applies to all checks when scope is "all"
              value:
                spell.id === "spell:vates_premonition"
                  ? effectDef.tempModifier.value + targetOvercast * 5
                  : effectDef.tempModifier.value,
              expires: untilTurnCounter,
            },
          ],
        },
      };

      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [target.actorId]: updatedTargetActor,
        },
      };

      const targetName = target.actor.name || target.actorId;
      // Premonition adds +5 per overcast, other temp modifiers don't scale
      const modifierValue =
        spell.id === "spell:vates_premonition"
          ? effectDef.tempModifier.value + targetOvercast * 5
          : effectDef.tempModifier.value;
      const modifierLog = `${targetName} ottiene modificatore ${
        modifierValue >= 0 ? "+" : ""
      }${modifierValue} a tutti i test (durata: ${scaledDuration} turni)`;
      updatedSave = appendCombatLog(updatedSave, modifierLog);
    }
  }

  if (effectDef.moveTarget && validTargetActors.length > 0) {
    const casterPos = combat.positions[turnActorId];
    for (const target of validTargetActors) {
      if (!casterPos) {
        break;
      }
      if (target.actorId === turnActorId) {
        continue;
      }
      const targetPos = updatedSave.runtime.combat?.positions[target.actorId];
      if (!targetPos) {
        continue;
      }
      const size = getActorSize(target.actor);
      const canBeMoved = size < 8;
      if (!canBeMoved) {
        continue;
      }

      const deltaX = targetPos.x - casterPos.x;
      const deltaY = targetPos.y - casterPos.y;
      if (deltaX === 0 && deltaY === 0) {
        continue;
      }

      let stepX = 0;
      let stepY = 0;
      if (deltaX === 0) {
        stepY = deltaY > 0 ? 1 : -1;
      } else if (deltaY === 0) {
        stepX = deltaX > 0 ? 1 : -1;
      } else {
        stepX = deltaX > 0 ? 1 : -1;
        stepY = deltaY > 0 ? 1 : -1;
      }

      let finalPos = targetPos;
      let blockedByWall = false;
      const canFly = target.actor.traits?.["trait:flyer"] !== undefined;
      const rawDistance =
        effectDef.moveTarget.distance === "radius"
          ? Math.max(0, effectStatBonus)
          : effectDef.moveTarget.distance;
      const distance = Math.max(0, rawDistance ?? 0);

      for (let step = 0; step < distance; step++) {
        const nextPos = { x: finalPos.x + stepX, y: finalPos.y + stepY };
        if (
          nextPos.x < 0 ||
          nextPos.y < 0 ||
          nextPos.x >= combat.grid.width ||
          nextPos.y >= combat.grid.height
        ) {
          blockedByWall = true;
          break;
        }

        const terrain = getCellTerrain(updatedSave, nextPos, terrainContentPack);
        if (!canFly && !terrain.walkable) {
          blockedByWall = true;
          break;
        }

        if (!canPlaceActorAt(updatedSave, target.actorId, nextPos, terrainContentPack, canFly)) {
          break;
        }

        finalPos = nextPos;
      }

      if (finalPos.x !== targetPos.x || finalPos.y !== targetPos.y) {
        updatedSave = {
          ...updatedSave,
          runtime: {
            ...updatedSave.runtime,
            combat: {
              ...updatedSave.runtime.combat!,
              positions: {
                ...updatedSave.runtime.combat!.positions,
                [target.actorId]: finalPos,
              },
            },
          },
        };
        const targetName = target.actor.name || target.actorId;
        updatedSave = appendCombatLog(updatedSave, `${targetName} viene spinto all'indietro.`);
      }

      if (blockedByWall) {
        const rollMode = getMagicRollMode(updatedSave.actorsById[turnActorId]);
        const rollA = rng.nextInt(1, 10);
        const rollB = rollMode === "normal" ? rollA : rng.nextInt(1, 10);
        const impactRoll =
          rollMode === "normal"
            ? rollA
            : rollMode === "best"
              ? Math.max(rollA, rollB)
              : Math.min(rollA, rollB);
        let armorSoak = getActorArmor(updatedSave, target.actor).soak;
        if (armorSoak > 0 && hasCondition(target.actor, "misfortune")) {
          armorSoak = Math.ceil(armorSoak / 2);
        }
        const touBonus = getCharacteristicBonus(updatedSave, target.actorId, "TOU", catalogs);
        const impactDamage = Math.max(0, impactRoll - armorSoak - touBonus);

        if (impactDamage > 0) {
          const damageResult = applyDamageToActor(target.actor, impactDamage, updatedSave, rng, storyPack, catalogs);
          updatedSave = {
            ...updatedSave,
            actorsById: {
              ...updatedSave.actorsById,
              [target.actorId]: damageResult.updatedActor,
            },
          };
          if (!damageResult.dieHardUsed) {
            updatedSave = trackCombatDamage(updatedSave, turnActorId, target.actorId, impactDamage);
          }
        }

        const targetName = target.actor.name || target.actorId;
        const impactLog = `${targetName} urta un ostacolo (danni ${impactDamage}).`;
        updatedSave = appendCombatLog(updatedSave, impactLog);
        updatedSave = appendRuntimeLog(updatedSave, {
          kind: "damage",
          attackerId: turnActorId,
          defenderId: target.actorId,
          formula: "1d10 (impatto)",
          rolls: [impactRoll],
          rawDamage: impactRoll,
          soak: armorSoak,
          touBonus,
          finalDamage: impactDamage,
          turnCounter: combat.turnCounter,
          resolutionId,
          tags: [`magic:spell=${spell.id}`, `magic:effect=${effectDef.id}`, "magic:forcedMoveImpact=1"],
        });
      }
    }
  }

  if (effectDef.moveTarget) {
    updatedSave = updateAuraEffects(updatedSave, catalogs);
  }

  // Apply conditions if effect has conditions
  if (effectDef.applyConditions && validTargetActors.length > 0) {
    for (const conditionSpec of effectDef.applyConditions) {
      const baseStacksValue =
        conditionSpec.value !== undefined ? conditionSpec.value + effectStatBonus : conditionSpec.value;
      const baseDurationValue =
        conditionSpec.durationRounds !== undefined ? conditionSpec.durationRounds + effectStatBonus : conditionSpec.durationRounds;

      for (const target of validTargetActors) {
        const targetOvercast = getOvercastForTarget(target.actorId);
        const prevMove =
          target.actorId === turnActorId ? calculateInitialMovement(target.actor, updatedSave, catalogs) : undefined;
        if (
          conditionSpec.trigger?.overcast !== undefined &&
          targetOvercast < conditionSpec.trigger.overcast
        ) {
          continue;
        }
        if (effectDef.aura?.applyToAllies && target.actorId !== turnActorId) {
          continue;
        }
        let finalStacks: number;
        let finalDuration: number | undefined;

        if (conditionSpec.conditionId === "force_field") {
          // Force Field: duration = base + overcast (base from durationRounds + effect stat)
          const baseDuration = baseDurationValue ?? 1;
          finalStacks = 1;
          finalDuration = baseDuration + targetOvercast;
        } else if (conditionSpec.conditionId === "force_shield") {
          // Force Shield: stacks = base + overcast, duration = base + overcast (base from durationRounds + effect stat)
          const baseDuration = baseDurationValue ?? 1;
          finalStacks = baseDuration + targetOvercast;
          finalDuration = baseDuration + targetOvercast;
        } else if (
          (conditionSpec.conditionId === "prone" || conditionSpec.conditionId === "fatigue") &&
          conditionSpec.durationRounds === undefined
        ) {
          // Prone/Fatigue without duration do not expire automatically
          const baseStacks = baseStacksValue ?? 1;
          finalStacks = baseStacks + Math.floor(targetOvercast / 2);
          finalDuration = undefined;
        } else if (conditionSpec.conditionId === "steel_body" || conditionSpec.conditionId === "warp_speed") {
          // Steel Body / Warp Speed: stacks = 1 + overcast (for scaling bonuses)
          const scaled = scaleCondition(baseStacksValue, baseDurationValue, targetOvercast);
          finalStacks = 1 + targetOvercast;
          finalDuration = scaled.durationTurns;
        } else if (conditionSpec.conditionId === "beast_form") {
          const baseDuration = baseDurationValue ?? 1;
          finalStacks = 1;
          finalDuration = baseDuration + targetOvercast;
        } else if (conditionSpec.conditionId === "giant_form") {
          const baseDuration = baseDurationValue ?? 1;
          finalStacks = 1;
          finalDuration = baseDuration + targetOvercast;
        } else if (
          conditionSpec.conditionId === "fiery_form" ||
          conditionSpec.conditionId === "flight" ||
          conditionSpec.conditionId === "weave_of_fate"
        ) {
          const baseDuration = baseDurationValue ?? 1;
          finalStacks = 1;
          finalDuration = baseDuration + targetOvercast;
        } else {
          // Other conditions: use normal scaling
          const scaled = scaleCondition(baseStacksValue, baseDurationValue, targetOvercast);
          finalStacks = scaled.stacks;
          finalDuration = scaled.durationTurns;
        }

        const untilTurnCounter =
          finalDuration === undefined ? undefined : combat.turnCounter + finalDuration;
        const spellSource = `spell:${spell.id}`;
        let conditionParams: Record<string, any> | undefined = undefined;

        if (effectDef.aura?.applyToAllies && target.actorId === turnActorId) {
          const auraRadius = effectDef.aura.radiusFromEffectStat
            ? Math.max(0, effectStatBonus)
            : Math.max(0, effectDef.aura.radiusSquares ?? 0);
          conditionParams = {
            ...(conditionParams ?? {}),
            aura: {
              radius: auraRadius,
              includeCaster: effectDef.aura.includeCaster !== false,
            },
          };
        }
        if (conditionSpec.conditionId === "invisibility") {
          conditionParams = {
            ...(conditionParams ?? {}),
            wilBonus: effectStatBonus,
          };
        }
        if (conditionSpec.conditionId === "fire_shield") {
          conditionParams = {
            ...(conditionParams ?? {}),
            wilBonus: effectStatBonus,
            overcast: targetOvercast,
          };
        }
        if (
          conditionSpec.conditionId === "sanctuary" ||
          conditionSpec.conditionId === "cursed_earth" ||
          conditionSpec.conditionId === "word_of_god"
        ) {
          conditionParams = {
            ...(conditionParams ?? {}),
            auraKind: conditionSpec.conditionId,
            auraPower: effectiveDoS,
            wilBonus: effectStatBonus,
            overcast: targetOvercast,
          };
        }

        const shouldApplyCondition =
          conditionSpec.conditionId !== "giant_form" && conditionSpec.conditionId !== "weave_of_fate";
        let updatedTargetActor = shouldApplyCondition
          ? addConditionToActor(
              target.actor,
              conditionSpec.conditionId as any,
              finalStacks,
              untilTurnCounter,
              spellSource,
              conditionSpec.conditionId === "force_field"
                ? {
                    x: 35 + targetOvercast * 5,
                    y: Math.max(0, 20 - targetOvercast * 2),
                  }
                : conditionParams
            )
          : target.actor;

        // For steel_body and warp_speed, also add characteristics to the trait
        // First remove any existing characteristics from this spell source (in case of re-casting)
        if (conditionSpec.conditionId === "steel_body" || conditionSpec.conditionId === "warp_speed") {
          updatedTargetActor = removeUnnaturalCharacteristicsBySource(updatedTargetActor, spellSource);
          
          // Now add the new characteristics
          if (conditionSpec.conditionId === "steel_body") {
            const characteristics = getSteelBodyCharacteristics(finalStacks);
            updatedTargetActor = addUnnaturalCharacteristics(updatedTargetActor, characteristics, spellSource);
          } else if (conditionSpec.conditionId === "warp_speed") {
            const characteristics = getWarpSpeedCharacteristics(finalStacks);
            updatedTargetActor = addUnnaturalCharacteristics(updatedTargetActor, characteristics, spellSource);
          }
        }

        if (conditionSpec.conditionId === "beast_form") {
          const wpb = effectStatBonus;
          updatedTargetActor = removeUnnaturalCharacteristicsBySource(updatedTargetActor, spellSource);
          updatedTargetActor = addTraitsWithSource(
            updatedTargetActor,
            {
              "trait:deadly_natural_weapons": {},
              "trait:warp_weapons": {},
              "trait:undying": {},
              "trait:from_beyond": {},
              "trait:regeneration": { x: wpb },
              "trait:magic_resistance": { x: wpb },
              "trait:natural_armour": { armor: wpb },
              "trait:natural_ability": {
                profiles: [
                  {
                    name: "Horn Attack",
                    kind: "MELEE",
                    damageType: "piercing",
                    damage: { tier: "single", add: wpb },
                    penetration: 3,
                  },
                  {
                    name: "Tentacle",
                    kind: "MELEE",
                    damageType: "impact",
                    damage: { tier: "single", add: wpb },
                    penetration: 0,
                  },
                  {
                    name: "Fire Breath",
                    kind: "RANGED",
                    damageType: "energy",
                    damage: { tier: "double", add: wpb },
                    penetration: 5,
                    range: 6,
                    qualities: [{ id: "spray" }, { id: "recharge", rank: 4 }],
                  },
                ],
              },
            },
            spellSource
          );
          const bonus = Math.ceil(wpb / 2);
          updatedTargetActor = addUnnaturalCharacteristics(
            updatedTargetActor,
            [
              { stat: "STR", bonusX: bonus },
              { stat: "TOU", bonusX: bonus },
              { stat: "AGI", bonusX: bonus },
            ],
            spellSource
          );
        }

        if (conditionSpec.conditionId === "giant_form") {
          const combatState = updatedSave.runtime.combat;
          const casterPos = combatState?.positions?.[target.actorId];
          const currentSize = getActorSize(updatedTargetActor);
          const sizeIncrease = Math.max(0, Math.min(10 - currentSize, 2 + targetOvercast));
          if (!combatState || !casterPos || sizeIncrease <= 0) {
            updatedSave = appendCombatLog(updatedSave, `${target.actor.name || target.actorId} non riesce a crescere.`);
            continue;
          }
          const newSize = currentSize + sizeIncrease;
          const simulatedSave: GameSave = {
            ...updatedSave,
            actorsById: {
              ...updatedSave.actorsById,
              [target.actorId]: {
                ...updatedTargetActor,
                traits: {
                  ...updatedTargetActor.traits,
                  "trait:size": { size: newSize },
                },
              },
            },
          };
          const canGrow = canPlaceActorAt(simulatedSave, target.actorId, casterPos, terrainContentPack);
          if (!canGrow) {
            updatedSave = appendCombatLog(updatedSave, `${target.actor.name || target.actorId} non ha spazio per crescere.`);
            continue;
          }
          const strDelta = sizeIncrease * 10;
          const touDelta = sizeIncrease * 10;
          const agiDelta = sizeIncrease * 5;
          const hadSizeTrait = updatedTargetActor.traits?.["trait:size"] !== undefined;
          updatedTargetActor = {
            ...updatedTargetActor,
            stats: {
              ...updatedTargetActor.stats,
              STR: (updatedTargetActor.stats.STR ?? 0) + strDelta,
              TOU: (updatedTargetActor.stats.TOU ?? 0) + touDelta,
              AGI: (updatedTargetActor.stats.AGI ?? 0) - agiDelta,
            },
            traits: {
              ...updatedTargetActor.traits,
              "trait:size": { size: newSize, _source: spellSource },
            },
          };
          updatedTargetActor = addConditionToActor(
            updatedTargetActor,
            conditionSpec.conditionId as any,
            finalStacks,
            untilTurnCounter,
            spellSource,
            {
              ...(conditionParams ?? {}),
              statDeltas: { STR: strDelta, TOU: touDelta, AGI: agiDelta },
              previousSize: currentSize,
              hadSizeTrait,
            }
          );
        }

        if (conditionSpec.conditionId === "flight") {
          const wpb = effectStatBonus;
          updatedTargetActor = addTraitsWithSource(updatedTargetActor, { "trait:flyer": { x: wpb } }, spellSource);
        }

        if (conditionSpec.conditionId === "weave_of_fate") {
          const currentFp = updatedTargetActor.resources.fatePoints ?? 0;
          updatedTargetActor = {
            ...updatedTargetActor,
            resources: {
              ...updatedTargetActor.resources,
              fatePoints: currentFp + 1,
            },
          };
          updatedTargetActor = addConditionToActor(
            updatedTargetActor,
            conditionSpec.conditionId as any,
            finalStacks,
            untilTurnCounter,
            spellSource,
            {
              ...(conditionParams ?? {}),
              originalFatePoints: currentFp,
              tempFate: 1,
            }
          );
        }

        if (conditionSpec.conditionId === "possession") {
          const bonus = effectStatBonus + targetOvercast;
          updatedTargetActor = addTraitsWithSource(
            updatedTargetActor,
            { "trait:daemonic": { x: bonus } },
            spellSource
          );
          updatedTargetActor = addUnnaturalCharacteristics(updatedTargetActor, [{ stat: "STR", bonusX: bonus }], spellSource);
          updatedTargetActor = addConditionToActor(
            updatedTargetActor,
            "frenzy",
            1,
            untilTurnCounter,
            spellSource
          );
        }

        updatedSave = {
          ...updatedSave,
          actorsById: {
            ...updatedSave.actorsById,
            [target.actorId]: updatedTargetActor,
          },
        };

        if (target.actorId === turnActorId && prevMove !== undefined) {
          const currentCombat = updatedSave.runtime.combat;
          const currentTurn = currentCombat?.turn;
          if (currentTurn) {
            const newMove = calculateInitialMovement(updatedTargetActor, updatedSave, catalogs);
            const delta = newMove - prevMove;
            if (delta !== 0) {
              const adjustedRemaining = Math.min(newMove, Math.max(0, currentTurn.moveRemaining + delta));
              updatedSave = {
                ...updatedSave,
                runtime: {
                  ...updatedSave.runtime,
                  combat: {
                    ...currentCombat,
                    turn: {
                      ...currentTurn,
                      moveRemaining: adjustedRemaining,
                    },
                  },
                },
              };
            }
          }
        }

        // Log condition application
        const targetName = target.actor.name || target.actorId;
        const conditionName = conditionSpec.conditionId;
        const durationLabel =
          finalDuration === undefined ? "permanente" : `${finalDuration} turni`;
        const conditionLog = `${targetName} ottiene ${conditionName} (stacks ${finalStacks}, durata ${durationLabel})`;
        updatedSave = appendCombatLog(updatedSave, conditionLog);
      }
    }
  }

  if (effectDef.aura?.applyToAllies) {
    updatedSave = updateAuraEffects(updatedSave, catalogs);
  }

  return updatedSave;
}
