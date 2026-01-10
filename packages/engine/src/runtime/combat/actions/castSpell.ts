import type { Effect, GameSave, StoryPack, SingleCheck, ActorId, CheckResult } from "../../types";
import type { IRNG } from "../../rng";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog, appendRuntimeLog, nextRuntimeSeq } from "../narration";
import { performCheckWithSave, resolveActor } from "../../checks";
import { getCharacteristicBonus } from "../../characters/bonuses";
import { getSpellById, getEffectById } from "../../magic/catalogs";
import { getMagicPower } from "../../magic/pm";
import { applyFatigue } from "../../magic/fatigue";
import { shouldTriggerPhenomena, getPhenomenaSeverity, rollPhenomena } from "../../magic/phenomena";
import { hasLearnedSpell } from "../../magic/learning";
import { addConditionToActor } from "../../conditions";
import { applyDamageToActor } from "../criticalDamage";
import { calculateMaxHp } from "../../characters/hp";
import { hasUnlockedAction } from "../../characters/actions";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";
import { resolveTargets } from "../../targeting/resolveTargets";
import { buildTargetingDefinition } from "../../targeting/spellTargeting";
import { convertLegacyTargetSpec } from "../../targeting/convertTargetSpec";
import { scaleDamage, scaleCondition, scaleHeal } from "../../magic/scaling";
import { getActorsInRange } from "../../targeting/getActorsInRange";
import type { TargetSpec } from "../../targeting/types";

/**
 * Cast Spell action: performs spell casting check and applies effects
 */
export function combatCastSpell(
  effect: Extract<Effect, { op: "combatCastSpell" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.actorId) {
    // Not caster's turn
    const blockedCheck: CheckResult = {
      checkId: "combat:castSpell:blocked",
      actorId: effect.actorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Load spell and effect definitions
  const spell = getSpellById(effect.spellId);
  if (!spell) {
    return { save };
  }

  const effectDef = getEffectById(spell.effectId);
  if (!effectDef) {
    return { save };
  }

  const actor = save.actorsById[turnActorId];
  if (!actor) {
    return { save };
  }

  // Load catalogs early for checks
  const catalogs: CharacterCatalogs | undefined =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;

  // Check if actor has magic gate trait (unlocks magic actions)
  // Note: Check for "magic:cast" action unlock (trait:weaver grants this)
  if (catalogs && !hasUnlockedAction(save, catalogs, turnActorId, "magic:cast")) {
    const blockedCheck: CheckResult = {
      checkId: "combat:castSpell:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=noMagicGate"],
    };
    let updatedSave: GameSave = {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: blockedCheck,
      },
    };
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: "Non puoi lanciare incantesimi: ti manca il tratto magico necessario.",
      turnCounter: combat.turnCounter,
    });
    return { save: updatedSave };
  }

  // Check if spell is learned
  if (!hasLearnedSpell(actor, effect.spellId)) {
    const blockedCheck: CheckResult = {
      checkId: "combat:castSpell:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=spellNotLearned"],
    };
    let updatedSave: GameSave = {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: blockedCheck,
      },
    };
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Non conosci l'incantesimo: ${spell.name}`,
      turnCounter: combat.turnCounter,
    });
    // DO NOT consume action or reset channeling on failure
    return { save: updatedSave };
  }

  // Check action economy
  if (spell.castTime === "free") {
    // Free spell: check if already used this turn
    const freeSpellUsed = combat.freeSpellUsedThisTurn?.[turnActorId] ?? false;
    if (freeSpellUsed) {
      const blockedCheck: CheckResult = {
        checkId: "combat:castSpell:blocked",
        actorId: turnActorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=freeSpellUsed"],
      };
      return {
        save: {
          ...save,
          runtime: {
            ...save.runtime,
            lastCheck: blockedCheck,
          },
        },
      };
    }
  } else {
    // Standard or Full Round: check action availability
    if (!combat.turn.actionAvailable) {
      const blockedCheck: CheckResult = {
        checkId: "combat:castSpell:blocked",
        actorId: turnActorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=noAction"],
      };
      return {
        save: {
          ...save,
          runtime: {
            ...save.runtime,
            lastCheck: blockedCheck,
          },
        },
      };
    }
  }

  // Check channeling bonus
  // Channeling persists until the actor does a non-channeling, non-casting action
  // OR until they cast a spell (then it's consumed)
  // Since channeling is only reset by non-channeling/non-casting actions, if it exists
  // and belongs to this actor, it's still valid
  const channeling = combat.channeling;
  const channelDoS = channeling?.actorId === turnActorId ? channeling.accumulatedDoS : 0;

  // Check for casting penalty from phenomena and remove it after applying
  const castingPenaltyModifier = actor.status.tempModifiers?.find(
    (mod) => mod.id === `phenomena:castingPenalty:${turnActorId}`
  );
  const hasCastingPenalty = !!castingPenaltyModifier;

  // Create casting check
  const castingCheck: SingleCheck = {
    id: `combat:cast:${spell.id}:${turnActorId}`,
    kind: "single",
    actorRef: { mode: "byId", actorId: turnActorId },
    key: effectDef.castingStat,
    difficulty: "NORMAL",
  };

  // Generate resolutionId
  const { save: saveWithSeq, seq } = nextRuntimeSeq(save);
  const resolutionId = `res:${seq}`;

  // Perform casting check (penalty will be applied via tempModifier system)
  const { result, save: afterCheckSave } = performCheckWithSave(
    castingCheck,
    storyPack,
    saveWithSeq,
    rng,
    resolutionId
  );

  // Remove casting penalty modifier AFTER check (it was consumed)
  let saveAfterPenaltyRemoval = afterCheckSave;
  if (hasCastingPenalty && afterCheckSave.actorsById[turnActorId]) {
    const actorAfterCheck = afterCheckSave.actorsById[turnActorId];
    const updatedActorAfterPenalty = {
      ...actorAfterCheck,
      status: {
        ...actorAfterCheck.status,
        tempModifiers: (actorAfterCheck.status.tempModifiers || []).filter(
          (mod) => mod.id !== `phenomena:castingPenalty:${turnActorId}`
        ),
      },
    };
    saveAfterPenaltyRemoval = {
      ...afterCheckSave,
      actorsById: {
        ...afterCheckSave.actorsById,
        [turnActorId]: updatedActorAfterPenalty,
      },
    };
  }

  if (!result) {
    return { save: saveAfterPenaltyRemoval };
  }

  // Calculate CN and effective DoS
  // Use effectDef.baseCN (which is the CN for the effect) or fallback to spell.baseCN
  const cnBase = effectDef.baseCN ?? spell.baseCN;
  const castDoS = result.dos;
  const effectiveDoS = castDoS + channelDoS;
  const success = effectiveDoS >= cnBase;
  const overcast = Math.max(0, effectiveDoS - cnBase);

  // Calculate PM
  const pm = getMagicPower(saveAfterPenaltyRemoval, turnActorId, catalogs);

  // Check for phenomena trigger (doubles only)
  const phenomenaTriggered = shouldTriggerPhenomena(result);
  const phenomenaSeverity = phenomenaTriggered ? getPhenomenaSeverity(cnBase, pm, effectiveDoS) : null;
  let rfToApply = 0;

  // Apply RF based on success/failure
  if (success) {
    // Success: apply RF
    if (cnBase > pm) {
      rfToApply += 1;
    }
    if (phenomenaTriggered) {
      rfToApply += 1;
    }
    if (effectDef.specialFatigue) {
      rfToApply += effectDef.specialFatigue;
    }
    // Healing spells: +1 RF total
    if (spell.discipline === "CORPUS" && effectDef.baseDamageDice) {
      rfToApply += 1;
    }
  } else {
    // Failure: apply RF
    if (cnBase > pm) {
      rfToApply += 1;
    }
    if (result.dof >= 2) {
      // Severe failure
      rfToApply += 2;
    }
    if (phenomenaTriggered) {
      rfToApply += 1;
    }
  }

  // Apply RF
  let updatedSave = saveAfterPenaltyRemoval;
  if (rfToApply > 0) {
    updatedSave = applyFatigue(updatedSave, turnActorId, rfToApply, catalogs);
  }

  // Resolve phenomena if triggered
  let phenomenaResult: { save: GameSave; kind: string; description: string } | null = null;
  if (phenomenaTriggered) {
    phenomenaResult = rollPhenomena(updatedSave, turnActorId, rng, catalogs);
    updatedSave = phenomenaResult.save;
    const phenomenaDesc = phenomenaResult.description;

    // Log phenomena
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Fenomeno magico: ${phenomenaDesc}`,
      turnCounter: combat.turnCounter,
      resolutionId,
    });

    const actorName = actor.name || turnActorId;
    const logEntry =
      actor.kind === "PC"
        ? `Fenomeno magico: ${phenomenaDesc}`
        : `${actorName} subisce un fenomeno magico: ${phenomenaDesc}`;
    updatedSave = appendCombatLog(updatedSave, logEntry);
  }

  // Apply spell effects if successful
  if (success) {
    // Convert targetSpec to new format (handle legacy format)
    let targetSpec: TargetSpec;
    if ("kind" in effect.targetSpec) {
      targetSpec = effect.targetSpec as TargetSpec;
    } else {
      // Legacy format - convert it
      targetSpec = convertLegacyTargetSpec(effect.targetSpec as any);
    }

    // Build targeting definition
    const targetingDef = buildTargetingDefinition(spell, effectDef, cnBase);

    // Handle random target phenomena
    if (phenomenaResult?.kind === "targetRandomization") {
      // Get rangeSquares from targeting definition
      let rangeSquares = 0;
      if (targetingDef.shape === "single" || targetingDef.shape === "line" || targetingDef.shape === "cone") {
        rangeSquares = targetingDef.rangeSquares;
      } else if (targetingDef.shape === "radius") {
        rangeSquares = targetingDef.rangeSquares;
      } else {
        // Self targeting - no randomization needed
        rangeSquares = 0;
      }

      if (rangeSquares > 0) {
        // Get original target actor ID if applicable (to exclude it)
        const originalTargetId = targetSpec.kind === "actor" ? targetSpec.actorId : undefined;

        // Get all valid actors in range
        const candidates = getActorsInRange(updatedSave, turnActorId, rangeSquares, {
          includeCaster: false,
          allowFriendlyFire: true,
          excludeActorId: originalTargetId, // Optional: avoid picking original target
        });

        if (candidates.length > 0) {
          // Pick random from candidates
          const randomIndex = rng.nextInt(0, candidates.length - 1);
          const randomTargetId = candidates[randomIndex];
          // Update targetSpec to point to random target
          targetSpec = { kind: "actor", actorId: randomTargetId };
        }
        // If no candidates, keep original targetSpec (fallback)
      }
    }

    // Resolve targets using new system
    const targetResolution = resolveTargets(updatedSave, turnActorId, targetSpec, targetingDef, {
      allowFriendlyFire: true, // MVP: allow friendly fire for spells
      includeCaster: spell.targetShape === "self",
    });

    if (targetResolution.invalidReason) {
      // Invalid targeting - log and return
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "system",
        message: `Targeting failed: ${targetResolution.invalidReason}`,
        turnCounter: combat.turnCounter,
        resolutionId,
      });
      return { save: updatedSave };
    }

    // Get target actors
    const targetActors = targetResolution.targetActorIds.map((id) => ({
      actorId: id,
      actor: updatedSave.actorsById[id]!,
    }));

    // Apply damage if effect has damage
    if (effectDef.baseDamageDice && targetActors.length > 0) {
      const scaled = scaleDamage(effectDef.baseDamageDice, effectDef.baseDamageFlat, overcast);

      // Roll damage dice
      let damageRolls: number[] = [];
      let totalDamage = scaled.flatPlus;
      for (let i = 0; i < scaled.diceCount; i++) {
        const roll = rng.nextInt(1, scaled.diceSides);
        damageRolls.push(roll);
        totalDamage += roll;
      }

      // Apply damage to each target
      for (const target of targetActors) {
        if (spell.discipline === "CORPUS" && effectDef.baseDamageDice) {
          // Healing: reduce wounds instead of applying damage
          const maxHp = catalogs
            ? calculateMaxHp(updatedSave, target.actor, catalogs)
            : target.actor.derived?.hpMax ?? 100;
          const woundsBefore = target.actor.resources.wounds ?? 0;
          const healedAmount = scaleHeal(totalDamage, overcast);
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

          // Log healing
          const formula = `${scaled.diceCount}d${scaled.diceSides}${
            scaled.flatPlus > 0 ? ` + ${scaled.flatPlus}` : ""
          }${overcast > 0 ? ` (overcast +${overcast * 2})` : ""}`;
          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "damage",
            attackerId: turnActorId,
            defenderId: target.actorId,
            formula,
            rolls: damageRolls,
            rawDamage: totalDamage,
            soak: 0,
            finalDamage: -healed, // Negative for healing
            turnCounter: combat.turnCounter,
            resolutionId,
            tags: [
              `magic:spell=${spell.id}`,
              `magic:effect=${effectDef.id}`,
              `magic:cn=${cnBase}`,
              `magic:dosTotal=${effectiveDoS}`,
              `magic:overcast=${overcast}`,
            ],
          });

          const targetName = target.actor.name || target.actorId;
          const healLog =
            actor.kind === "PC"
              ? `Ripristini ${healed} HP a ${targetName}.`
              : `${actor.name || turnActorId} ripristina ${healed} HP a ${targetName}.`;
          updatedSave = appendCombatLog(updatedSave, healLog);
        } else {
          // Damage: apply true damage (bypasses armor for MVP)
          const damageResult = applyDamageToActor(target.actor, totalDamage, updatedSave, rng, storyPack, catalogs);
          updatedSave = {
            ...updatedSave,
            actorsById: {
              ...updatedSave.actorsById,
              [target.actorId]: damageResult.updatedActor,
            },
          };

          // Log damage
          const formula = `${scaled.diceCount}d${scaled.diceSides}${
            scaled.flatPlus > 0 ? ` + ${scaled.flatPlus}` : ""
          }${overcast > 0 ? ` (overcast +${overcast * 2})` : ""}`;
          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "damage",
            attackerId: turnActorId,
            defenderId: target.actorId,
            formula,
            rolls: damageRolls,
            rawDamage: totalDamage,
            soak: 0,
            finalDamage: totalDamage,
            turnCounter: combat.turnCounter,
            resolutionId,
            tags: [
              `magic:spell=${spell.id}`,
              `magic:effect=${effectDef.id}`,
              `magic:cn=${cnBase}`,
              `magic:dosTotal=${effectiveDoS}`,
              `magic:overcast=${overcast}`,
            ],
          });

          const targetName = target.actor.name || target.actorId;
          const damageLog =
            actor.kind === "PC"
              ? `Infliggi ${totalDamage} danni a ${targetName}.`
              : `${actor.name || turnActorId} infligge ${totalDamage} danni a ${targetName}.`;
          updatedSave = appendCombatLog(updatedSave, damageLog);
        }
      }
    }

    // Apply conditions if effect has conditions
    if (effectDef.applyConditions && targetActors.length > 0) {
      for (const conditionSpec of effectDef.applyConditions) {
        for (const target of targetActors) {
          const scaled = scaleCondition(conditionSpec.value, conditionSpec.durationRounds, overcast);
          const untilTurnCounter = combat.turnCounter + scaled.durationTurns;

          const updatedTargetActor = addConditionToActor(
            target.actor,
            conditionSpec.conditionId as any,
            scaled.stacks,
            untilTurnCounter,
            `spell:${spell.id}`
          );

          updatedSave = {
            ...updatedSave,
            actorsById: {
              ...updatedSave.actorsById,
              [target.actorId]: updatedTargetActor,
            },
          };
        }
      }
    }
  }

  // Update combat state: consume action/movement
  const updatedCombat = {
    ...updatedSave.runtime.combat!,
    turn: {
      ...updatedSave.runtime.combat!.turn,
      actionAvailable: spell.castTime === "free" ? updatedSave.runtime.combat!.turn.actionAvailable : false,
      moveRemaining: spell.castTime === "fullRound" ? 0 : updatedSave.runtime.combat!.turn.moveRemaining,
    },
    freeSpellUsedThisTurn: {
      ...(updatedSave.runtime.combat!.freeSpellUsedThisTurn || {}),
      ...(spell.castTime === "free" ? { [turnActorId]: true } : {}),
    },
    channeling: undefined, // Consume channeling after cast
  };

  updatedSave = {
    ...updatedSave,
    runtime: {
      ...updatedSave.runtime,
      combat: updatedCombat,
      lastCheck: {
        ...result,
        tags: [
          ...(result.tags || []),
          `magic:spell=${spell.id}`,
          `magic:effect=${effectDef.id}`,
          `magic:cn=${cnBase}`,
          `magic:dosTotal=${effectiveDoS}`,
          `magic:overcast=${overcast}`,
          ...(channelDoS > 0 ? [`magic:channelDoS=${channelDoS}`] : []),
        ],
      },
    },
  };

  // Add narration
  const actorName = actor.name || turnActorId;
  const spellName = spell.name;
  if (success) {
    const logEntry = actor.kind === "PC" ? `Lanci ${spellName}.` : `${actorName} lancia ${spellName}.`;
    updatedSave = appendCombatLog(updatedSave, logEntry);
  } else {
    const logEntry =
      actor.kind === "PC"
        ? `Tentativo di lanciare ${spellName} fallito.`
        : `${actorName} fallisce il tentativo di lanciare ${spellName}.`;
    updatedSave = appendCombatLog(updatedSave, logEntry);
  }

  return { save: updatedSave };
}
