import type { Effect, GameSave, StoryPack, SingleCheck, ActorId, CheckResult } from "../../types";
import type { IRNG } from "../../rng";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog, appendRuntimeLog, nextRuntimeSeq } from "../narration";
import { performCheckWithSave } from "../../checks";
import { getSpellById, getEffectById } from "../../magic/catalogs";
import { getMagicPower } from "../../magic/pm";
import { applyFatigue } from "../../characters/fatigue";
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
import { posKey } from "../../items";
import type { ItemRef } from "../../types";

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

  // Check for casting penalty from phenomena (will be consumed after check)
  // Use stable ID "phenomena:castingPenalty"
  const castingPenaltyModifier = actor.status.tempModifiers?.find((mod) => mod.id === "phenomena:castingPenalty");
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

  // Handle null result (should not happen, but TypeScript requires it)
  if (!result) {
    return {
      save: appendRuntimeLog(afterCheckSave, {
        kind: "system",
        message: "Errore nel controllo di lancio incantesimo",
        turnCounter: combat.turnCounter,
      }),
    };
  }

  // Remove casting penalty modifier AFTER check (consumes it even if cast fails)
  let saveAfterPenaltyRemoval = afterCheckSave;
  if (hasCastingPenalty && afterCheckSave.actorsById[turnActorId]) {
    const actorAfterCheck = afterCheckSave.actorsById[turnActorId];
    const updatedActorAfterPenalty = {
      ...actorAfterCheck,
      status: {
        ...actorAfterCheck.status,
        tempModifiers: (actorAfterCheck.status.tempModifiers || []).filter(
          (mod) => mod.id !== "phenomena:castingPenalty"
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
    // RF on success (e.g., healing spells)
    if (effectDef.rfOnSuccess) {
      rfToApply += effectDef.rfOnSuccess;
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

  // Resolve phenomena if triggered (applies to both success and failure)
  let phenomenaResult: { save: GameSave; kind: string; description: string } | null = null;
  if (phenomenaTriggered) {
    phenomenaResult = rollPhenomena(updatedSave, turnActorId, rng, catalogs);
    updatedSave = phenomenaResult.save;
    const phenomenaDesc = phenomenaResult.description;
    const severity = phenomenaSeverity || "mild";

    // Log phenomena
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Fenomeno magico: ${phenomenaDesc}`,
      turnCounter: combat.turnCounter,
      resolutionId,
    });

    const actorAfterCheck = updatedSave.actorsById[turnActorId] || actor;
    const actorName = actorAfterCheck.name || turnActorId;
    const phenomenaLog =
      actorAfterCheck.kind === "PC"
        ? `Fenomeno: ${phenomenaDesc} (${severity})`
        : `${actorName} subisce un fenomeno magico: ${phenomenaDesc} (${severity})`;
    updatedSave = appendCombatLog(updatedSave, phenomenaLog);

    // Persist RNG counter after phenomena rolls (if RNG is an RNG instance)
    // Note: This ensures determinism - phenomena rolls consume RNG state
    if (typeof (rng as any).getCounter === "function") {
      updatedSave = {
        ...updatedSave,
        runtime: {
          ...updatedSave.runtime,
          rngCounter: (rng as any).getCounter(),
        },
      };
    }
  }

  // Consume action economy and reset channeling (applies to both success and failure)
  // Cast is "the next action after channeling", so channeling resets
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
    channeling: undefined, // Consume channeling after cast attempt
  };

  // Handle failure case
  if (!success) {
    const actorAfterCheck = updatedSave.actorsById[turnActorId] || actor;
    const actorName = actorAfterCheck.name || turnActorId;
    const spellName = spell.name;

    // Log cast failure
    const failureLog =
      actorAfterCheck.kind === "PC"
        ? `Lanci ${spellName} (CN ${cnBase}) → FALLIMENTO (DoF: ${result.dof})`
        : `${actorName} lancia ${spellName} (CN ${cnBase}) → FALLIMENTO (DoF: ${result.dof})`;
    updatedSave = appendCombatLog(updatedSave, failureLog);

    // Return with action economy consumed, channeling reset, and lastCheck set
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
            `magic:kind=${effectDef.kind}`,
            ...(channelDoS > 0 ? [`magic:channelDoS=${channelDoS}`] : []),
          ],
        },
      },
    };

    return { save: updatedSave };
  }

  // Log cast summary for success (standardized format)
  const actorAfterCheck = updatedSave.actorsById[turnActorId] || actor;
  const actorName = actorAfterCheck.name || turnActorId;
  const spellName = spell.name;
  const castSummaryLog =
    actorAfterCheck.kind === "PC"
      ? `Lanci ${spellName} (CN ${cnBase}) → SUCCESSO (DoS: ${castDoS}${
          channelDoS > 0 ? ` + Channel: ${channelDoS}` : ""
        } = ${effectiveDoS}, Overcast: ${overcast})`
      : `${actorName} lancia ${spellName} (CN ${cnBase}) → SUCCESSO (DoS: ${castDoS}${
          channelDoS > 0 ? ` + Channel: ${channelDoS}` : ""
        } = ${effectiveDoS}, Overcast: ${overcast})`;
  updatedSave = appendCombatLog(updatedSave, castSummaryLog);

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

    // Build targeting definition (with overcast for range scaling)
    const targetingDef = buildTargetingDefinition(spell, effectDef, cnBase, overcast);

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

    // Log target resolution
    if (targetActors.length > 0) {
      const targetNames = targetActors.map((t) => t.actor.name || t.actorId).join(", ");
      const targetLog = `Bersagli: ${targetNames}`;
      updatedSave = appendCombatLog(updatedSave, targetLog);
    }

    // Initialize valid targets (will be filtered by opposed saves if needed)
    let validTargetActors = [...targetActors];

    // Handle opposed saves FIRST (before any effect application)
    // Filter out targets that successfully resist
    // Skip this block for combatDisarmAtRange - it handles its own opposed check
    if (effectDef.opposed && effectDef.specialOp !== "combatDisarmAtRange" && targetActors.length > 0) {
      const opposedStat = effectDef.opposedStat || effectDef.castingStat;
      const opposedDifficulty = effectDef.opposedDifficulty || "NORMAL";

      const resistedTargetIds = new Set<ActorId>();

      for (const target of targetActors) {
        // Perform opposed check: caster's casting check result vs defender's resistance check
        const defenderCheck: SingleCheck = {
          id: `combat:cast:opposed:${spell.id}:${target.actorId}`,
          kind: "single",
          actorRef: { mode: "byId", actorId: target.actorId },
          key: opposedStat,
          difficulty: opposedDifficulty,
        };

        const { result: defenderResult, save: saveAfterDefenderCheck } = performCheckWithSave(
          defenderCheck,
          storyPack,
          updatedSave,
          rng,
          `res:opposed:${spell.id}:${target.actorId}`
        );

        updatedSave = saveAfterDefenderCheck;

        if (!defenderResult) {
          // Check failed - treat as resisted
          resistedTargetIds.add(target.actorId);
          continue;
        }

        // Compare DoS: attacker wins if attacker DoS > defender DoS
        const attackerDoS = effectiveDoS;
        const defenderDoS = defenderResult.success ? defenderResult.dos : -1; // Failed defender = -1 DoS

        if (attackerDoS > defenderDoS) {
          // Attacker wins - target is valid for effect application
          const targetName = target.actor.name || target.actorId;
          const opposedLog = `${targetName} resiste con ${opposedStat} ma fallisce (DoS attaccante: ${attackerDoS}, DoS difensore: ${defenderDoS})`;
          updatedSave = appendCombatLog(updatedSave, opposedLog);
        } else {
          // Defender wins - spell fails against this target
          const targetName = target.actor.name || target.actorId;
          const resistedLog = `${targetName} resiste con successo (DoS attaccante: ${attackerDoS}, DoS difensore: ${defenderDoS})`;
          updatedSave = appendCombatLog(updatedSave, resistedLog);

          // Mark as resisted
          resistedTargetIds.add(target.actorId);
        }
      }

      // Filter out resisted targets
      validTargetActors = targetActors.filter((t) => !resistedTargetIds.has(t.actorId));
    }

    // Apply damage/heal if effect has baseDamageDice
    // Skip if kind is "fatigue" (handled separately)
    // "blessing" and "malediction" effects should not have baseDamageDice (they use conditions/modifiers)
    // But if they do, we still process damage (e.g., kinesis_force_push has damage + condition)
    if (effectDef.baseDamageDice && effectDef.kind !== "fatigue" && validTargetActors.length > 0) {
      const scaled = scaleDamage(effectDef.baseDamageDice, effectDef.baseDamageFlat, overcast);

      // Roll damage dice
      let damageRolls: number[] = [];
      let totalDamage = scaled.flatPlus;
      for (let i = 0; i < scaled.diceCount; i++) {
        const roll = rng.nextInt(1, scaled.diceSides);
        damageRolls.push(roll);
        totalDamage += roll;
      }

      // Apply damage/heal to each target
      for (const target of validTargetActors) {
        if (effectDef.kind === "heal") {
          // Healing: reduce wounds instead of applying damage
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
              `magic:kind=${effectDef.kind}`,
            ],
          });

          const targetName = target.actor.name || target.actorId;
          const maxHpActual = catalogs
            ? calculateMaxHp(updatedSave, target.actor, catalogs)
            : target.actor.derived?.hpMax ?? 100;
          const hpBefore = maxHpActual - woundsBefore;
          const hpAfter = maxHpActual - woundsAfter;
          const healLog = `${targetName} recupera ${healed} HP (HP: ${hpBefore}→${hpAfter})`;
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
              `magic:kind=${effectDef.kind}`,
            ],
          });

          const targetName = target.actor.name || target.actorId;
          // Calculate HP before/after for logging
          const maxHpActual = catalogs
            ? calculateMaxHp(updatedSave, target.actor, catalogs)
            : target.actor.derived?.hpMax ?? 100;
          const woundsBefore = target.actor.resources.wounds ?? 0;
          const woundsAfter = damageResult.updatedActor.resources.wounds ?? 0;
          const hpBefore = maxHpActual - woundsBefore;
          const hpAfter = maxHpActual - woundsAfter;
          const damageLog = `${targetName} subisce ${totalDamage} danni (HP: ${hpBefore}→${hpAfter})`;
          updatedSave = appendCombatLog(updatedSave, damageLog);
        }
      }
    }

    // Handle special operations (e.g., combatDisarmAtRange)
    if (effectDef.specialOp === "combatDisarmAtRange" && validTargetActors.length > 0) {
      const disarmedTargetIds = new Set<ActorId>();

      for (const target of validTargetActors) {
        // For ranged disarm, we need to perform an opposed check first
        // Then if successful, apply disarm effect
        const opposedStat = effectDef.opposedStat || "STR";
        const opposedDifficulty = effectDef.opposedDifficulty || "-20";

        const defenderCheck: SingleCheck = {
          id: `combat:cast:disarm:opposed:${spell.id}:${target.actorId}`,
          kind: "single",
          actorRef: { mode: "byId", actorId: target.actorId },
          key: opposedStat,
          difficulty: opposedDifficulty,
        };

        const { result: defenderResult, save: saveAfterDefenderCheck } = performCheckWithSave(
          defenderCheck,
          storyPack,
          updatedSave,
          rng,
          `res:disarm:opposed:${spell.id}:${target.actorId}`
        );

        updatedSave = saveAfterDefenderCheck;

        if (!defenderResult) {
          // Check failed - treat as resisted
          const targetName = target.actor.name || target.actorId;
          const resistedLog = `${targetName} resiste al disarmo a distanza`;
          updatedSave = appendCombatLog(updatedSave, resistedLog);
          continue;
        }

        const attackerDoS = effectiveDoS;
        const defenderDoS = defenderResult.success ? defenderResult.dos : -1;

        if (attackerDoS > defenderDoS) {
          // Success - perform disarm (reuse disarm logic but skip range/action checks)
          const defender = target.actor;
          const defenderMainHand = defender.equipment?.mainHand;
          const defenderWeaponId = defenderMainHand?.kind === "weapon" ? defenderMainHand.id : null;

          if (defenderWeaponId && defenderWeaponId !== "unarmed") {
            // Create ItemRef for the weapon being dropped
            const weaponItemRef: ItemRef = { kind: "weapon", id: defenderWeaponId };

            // Update defender equipment (clear mainHand)
            const updatedDefender = {
              ...defender,
              equipment: {
                ...defender.equipment,
                mainHand: null,
              },
            };

            // Add weapon to groundItemsByPos at defender position
            const defenderPos = combat.positions[target.actorId];
            if (defenderPos) {
              const posKeyStr = posKey(defenderPos);
              const currentGroundItemsByPos = combat.groundItemsByPos || {};
              const itemsAtPos = currentGroundItemsByPos[posKeyStr] || [];
              const updatedGroundItemsByPos = {
                ...currentGroundItemsByPos,
                [posKeyStr]: [...itemsAtPos, weaponItemRef],
              };

              const updatedCombat = {
                ...updatedSave.runtime.combat!,
                groundItemsByPos: updatedGroundItemsByPos,
              };

              updatedSave = {
                ...updatedSave,
                actorsById: {
                  ...updatedSave.actorsById,
                  [target.actorId]: updatedDefender,
                },
                runtime: {
                  ...updatedSave.runtime,
                  combat: updatedCombat,
                },
              };

              const attacker = updatedSave.actorsById[turnActorId];
              const attackerName = attacker?.name || turnActorId;
              const targetName = target.actor.name || target.actorId;
              const weaponName = save.weaponsById?.[defenderWeaponId]?.name || "l'arma";
              const disarmLog =
                attacker?.kind === "PC"
                  ? `Disarmi ${targetName} a distanza! ${weaponName} cade a terra.`
                  : `${attackerName} disarma ${targetName} a distanza! ${weaponName} cade a terra.`;
              updatedSave = appendCombatLog(updatedSave, disarmLog);
              disarmedTargetIds.add(target.actorId);
            }
          }
        }
      }

      // Remove disarmed targets from valid targets (they've been processed)
      validTargetActors = validTargetActors.filter((t) => !disarmedTargetIds.has(t.actorId));
    }

    // Apply fatigue effects (for mentis_disrupt)
    if (effectDef.kind === "fatigue" && validTargetActors.length > 0) {
      for (const target of validTargetActors) {
        let totalFatigue = 0;

        // Use applyFatigueDice if present
        if (effectDef.applyFatigueDice) {
          // Roll fatigue dice
          let fatigueRolls: number[] = [];
          for (let i = 0; i < effectDef.applyFatigueDice.dice; i++) {
            const roll = rng.nextInt(1, effectDef.applyFatigueDice.sides);
            fatigueRolls.push(roll);
            totalFatigue += roll;
          }

          // Scale with overcast
          totalFatigue += overcast;

          // Apply fatigue
          updatedSave = applyFatigue(updatedSave, target.actorId, totalFatigue, catalogs);

          const targetName = target.actor.name || target.actorId;
          const fatigueLog = `${targetName} subisce ${totalFatigue} Fatigue (${effectDef.applyFatigueDice.dice}d${
            effectDef.applyFatigueDice.sides
          }${overcast > 0 ? ` + ${overcast} overcast` : ""})`;
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
        const scaledDuration = effectDef.tempModifier.durationRounds + overcast;
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
                    ? effectDef.tempModifier.value + overcast * 5
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
            ? effectDef.tempModifier.value + overcast * 5
            : effectDef.tempModifier.value;
        const modifierLog = `${targetName} ottiene modificatore ${
          modifierValue >= 0 ? "+" : ""
        }${modifierValue} a tutti i test (durata: ${scaledDuration} turni)`;
        updatedSave = appendCombatLog(updatedSave, modifierLog);
      }
    }

    // Apply conditions if effect has conditions
    if (effectDef.applyConditions && validTargetActors.length > 0) {
      for (const conditionSpec of effectDef.applyConditions) {
        for (const target of validTargetActors) {
          let finalStacks: number;
          let finalDuration: number;

          if (conditionSpec.conditionId === "force_shield") {
            // Force Shield: stacks = cnBase + overcast, duration = cnBase + overcast
            finalStacks = cnBase + overcast;
            finalDuration = cnBase + overcast;
          } else if (conditionSpec.conditionId === "steel_body" || conditionSpec.conditionId === "warp_speed") {
            // Steel Body / Warp Speed: stacks = 1 + overcast (for scaling bonuses)
            const scaled = scaleCondition(conditionSpec.value, conditionSpec.durationRounds, overcast);
            finalStacks = 1 + overcast;
            finalDuration = scaled.durationTurns;
          } else {
            // Other conditions: use normal scaling
            const scaled = scaleCondition(conditionSpec.value, conditionSpec.durationRounds, overcast);
            finalStacks = scaled.stacks;
            finalDuration = scaled.durationTurns;
          }

          const untilTurnCounter = combat.turnCounter + finalDuration;

          const updatedTargetActor = addConditionToActor(
            target.actor,
            conditionSpec.conditionId as any,
            finalStacks,
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

          // Log condition application
          const targetName = target.actor.name || target.actorId;
          const conditionName = conditionSpec.conditionId;
          const conditionLog = `${targetName} ottiene ${conditionName} (stacks ${finalStacks}, durata ${finalDuration} turni)`;
          updatedSave = appendCombatLog(updatedSave, conditionLog);
        }
      }
    }
  }

  // Update combat state with action economy consumption (already done above for failure case)
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
          `magic:kind=${effectDef.kind}`,
          ...(channelDoS > 0 ? [`magic:channelDoS=${channelDoS}`] : []),
        ],
      },
    },
  };

  return { save: updatedSave };
}
