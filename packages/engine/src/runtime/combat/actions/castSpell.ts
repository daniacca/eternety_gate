import type { Effect, GameSave, StoryPack, SingleCheck, ActorId, CheckResult, StatKey } from "../../types";
import type { IRNG } from "../../rng";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog, appendRuntimeLog, nextRuntimeSeq } from "../narration";
import { performCheckWithSave } from "../../checks";
import { getSpellById, getEffectById } from "../../magic/catalogs";
import { getMagicPower } from "../../magic/pm";
import { applyFatigue } from "../../characters/fatigue";
import { getCharacteristicBonus } from "../../characters/bonuses";
import { shouldTriggerPhenomena, getPhenomenaSeverity, rollPhenomena } from "../../magic/phenomena";
import { hasLearnedSpell } from "../../magic/learning";
import { addConditionToActor } from "../../conditions";
import {
  addUnnaturalCharacteristics,
  getSteelBodyCharacteristics,
  getWarpSpeedCharacteristics,
  removeUnnaturalCharacteristicsBySource,
} from "../../characters/traitHelpers";
import { applyDamageToActor } from "../criticalDamage";
import { calculateMaxHp } from "../../characters/hp";
import { hasUnlockedAction } from "../../characters/actions";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";
import { buildSpellTargetSpec, computeTargetPreview } from "../targeting/computeTargeting";
import { scaleDamage, scaleCondition, scaleHeal } from "../../magic/scaling";
import { getActorsInRange } from "../../targeting/getActorsInRange";
import type { TargetSpec, TargetSelection, TargetPreview } from "../targeting/types";
import { posKey } from "../../items";
import type { ItemRef } from "../../types";
import { hasDenyTheWitch, getBestResistStat, performDenyTheWitchCheck } from "../../magic/denyTheWitch";
import { getResistanceBonus } from "../../characters/talentModifiers";
import { getMagicResistanceAgainstSpell } from "../../magic/resistance";
import { getUntouchableDenyBonus } from "../../characters/untouchable";
import { hasTrait } from "../../characters/prerequisites";
import { resolveForceFieldBlock } from "../forceField";
import { trackCombatDamage } from "../damageTracking";
import { getUntouchableAuraImpact } from "../untouchableAura";

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

  const castOptions = effect.castOptions;

  const actor = save.actorsById[turnActorId];
  if (!actor) {
    return { save };
  }
  if (actor.conditions?.frenzy) {
    const blockedCheck: CheckResult = {
      checkId: "combat:castSpell:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=frenzy"],
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

  const cnBase = spell.baseCN;

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
  if (catalogs && !castOptions?.ignoreWeaverRequirement && !hasUnlockedAction(save, catalogs, turnActorId, "magic:cast")) {
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

  const shockedActor = save.actorsById[turnActorId];
  if (shockedActor?.conditions?.shock && spell.castTime === "fullRound") {
    const blockedCheck: CheckResult = {
      checkId: "combat:castSpell:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=shock"],
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

  let currentSave = save;
  if (castOptions?.magicConduct) {
    if (catalogs && !hasUnlockedAction(save, catalogs, turnActorId, "magic:conduct")) {
      const blockedCheck: CheckResult = {
        checkId: "combat:castSpell:blocked",
        actorId: turnActorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=actionNotUnlocked", "magic:conduct=1"],
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
    const fatePoints = actor.resources.fatePoints ?? 0;
    if (fatePoints <= 0) {
      const blockedCheck: CheckResult = {
        checkId: "combat:castSpell:blocked",
        actorId: turnActorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=noFatePoint", "magic:conduct=1"],
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
    currentSave = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [turnActorId]: {
          ...actor,
          resources: {
            ...actor.resources,
            fatePoints: fatePoints - 1,
          },
        },
      },
    };
  }

  const targetSelection: TargetSelection = effect.targetSelection;
  const spellTargetSpec: TargetSpec = buildSpellTargetSpec(spell, effectDef, cnBase);
  let targetPreview: TargetPreview = computeTargetPreview(currentSave, turnActorId, spellTargetSpec, targetSelection);

  if (!targetPreview.valid) {
    const invalidMessage = targetPreview.reason
      ? `Targeting non valido: ${targetPreview.reason}`
      : "Targeting non valido";
    const loggedSave = appendRuntimeLog(currentSave, {
      kind: "system",
      message: invalidMessage,
      turnCounter: combat.turnCounter,
    });
    return { save: loggedSave };
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

  // Untouchable aura penalty applies when a weaver casts within the aura
  let auraPenalty = 0;
  if (catalogs && hasTrait(actor, "trait:weaver", save)) {
    const impact = getUntouchableAuraImpact(save, catalogs, turnActorId);
    if (impact) {
      auraPenalty = impact.penalty;
    }
  }

  // Create casting check
  const castingCheck: SingleCheck = {
    id: `combat:cast:${spell.id}:${turnActorId}`,
    kind: "single",
    actorRef: { mode: "byId", actorId: turnActorId },
    key: effectDef.castingStat,
    difficulty: "Challenging",
    modifier: auraPenalty !== 0 ? auraPenalty : undefined,
  };

  // Generate resolutionId
  const { save: saveWithSeq, seq } = nextRuntimeSeq(currentSave);
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
  const castDoS = result.dos;
  let effectiveDoS = castDoS + channelDoS;
  const baseSuccess = effectiveDoS >= cnBase;
  if (baseSuccess && castOptions?.magicConduct) {
    const magicConductBonus = rng.nextInt(1, 5);
    effectiveDoS += magicConductBonus;
    saveAfterPenaltyRemoval = appendRuntimeLog(saveAfterPenaltyRemoval, {
      kind: "system",
      message: `Magic Conduct: +${magicConductBonus} DoS`,
      turnCounter: combat.turnCounter,
      resolutionId,
      tags: ["magic:conduct", `dosBonus=${magicConductBonus}`],
    });
  }
  const success = baseSuccess;
  const rawOvercast = Math.max(0, effectiveDoS - cnBase);
  const overcast = castOptions?.noOvercast ? 0 : rawOvercast;
  const manifestedPM = cnBase + overcast;

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

  if (castOptions?.skipRfCost) {
    rfToApply = 0;
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
    targetPreview = computeTargetPreview(updatedSave, turnActorId, spellTargetSpec, targetSelection);

    if (phenomenaResult?.kind === "targetRandomization" && spellTargetSpec.shape.kind === "single") {
      const rangeSquares = spellTargetSpec.shape.range;
      if (rangeSquares > 0) {
        const candidates = getActorsInRange(updatedSave, turnActorId, rangeSquares, {
          includeCaster: false,
          allowFriendlyFire: true,
        });
        if (candidates.length > 0) {
          const randomIndex = rng.nextInt(0, candidates.length - 1);
          const randomTargetId = candidates[randomIndex];
          const randomPos = updatedSave.runtime.combat?.positions[randomTargetId];
          if (randomPos) {
            const randomizedSelection: TargetSelection = { kind: "single", targetPos: randomPos };
            targetPreview = computeTargetPreview(updatedSave, turnActorId, spellTargetSpec, randomizedSelection);

            // Phenomena: explicit log so players understand the retarget happened.
            // NOTE: keep deterministic - do not add any extra RNG calls here.
            const phenomenonMessage = "La Trama sfugge al controllo: il bersaglio cambia!";
            updatedSave = appendCombatLog(updatedSave, phenomenonMessage);

            const tags: string[] = [
              "magic:phenomena=targetRandomization",
              `magic:spell=${spell.id}`,
              `magic:caster=${turnActorId}`,
              `magic:randomTarget=${randomTargetId}`,
              `magic:randomPos=${randomPos.x},${randomPos.y}`,
            ];

            // If resolvable (and not too spammy), include affected actor ids for debugging.
            const affected = targetPreview.affectedActorIds ?? [];
            for (const id of affected.slice(0, 5)) {
              tags.push(`magic:affectedActor=${id}`);
            }
            if (affected.length > 5) {
              tags.push(`magic:affectedActorsMore=${affected.length - 5}`);
            }

            updatedSave = appendRuntimeLog(updatedSave, {
              kind: "system",
              message: phenomenonMessage,
              turnCounter: combat.turnCounter,
              resolutionId,
              tags,
            });
          }
        }
      }
    }

    if (!targetPreview.valid) {
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "system",
        message: `Targeting failed: ${targetPreview.reason || "invalid"}`,
        turnCounter: combat.turnCounter,
        resolutionId,
      });
      return { save: updatedSave };
    }

    const targetActors = targetPreview.affectedActorIds
      .map((id) => ({
        actorId: id,
        actor: updatedSave.actorsById[id],
      }))
      .filter((t): t is { actorId: ActorId; actor: NonNullable<typeof updatedSave.actorsById[string]> } => !!t.actor);

    // Log target resolution
    if (targetActors.length > 0) {
      const targetNames = targetActors.map((t) => t.actor.name || t.actorId).join(", ");
      const targetLog = `Bersagli: ${targetNames}`;
      updatedSave = appendCombatLog(updatedSave, targetLog);
    }

    // Initialize valid targets (will be filtered by opposed saves if needed)
    let validTargetActors = [...targetActors];

    const targetOvercastById = new Map<ActorId, number>();

    // Magic Resistance (per target): may fully resist or reduce overcast for that target
    if (catalogs && targetActors.length > 0) {
      const resistedByMr = new Set<ActorId>();

      for (const target of targetActors) {
        const mr = getMagicResistanceAgainstSpell(updatedSave, target.actorId, turnActorId, catalogs);
        if (mr >= manifestedPM) {
          resistedByMr.add(target.actorId);
          const targetName = target.actor.name || target.actorId;
          const resistedLog = `${targetName} resiste alla magia (RM ${mr} >= PM ${manifestedPM}).`;
          updatedSave = appendCombatLog(updatedSave, resistedLog);

          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "system",
            message: `Magic resistance: ${target.actorId} resists ${spell.id} (MR ${mr} >= PM ${manifestedPM})`,
            turnCounter: combat.turnCounter,
            resolutionId,
            tags: [
              "magic:resisted",
              `magic:mr=${mr}`,
              `magic:pm=${manifestedPM}`,
              `magic:spell=${spell.id}`,
              `magic:target=${target.actorId}`,
            ],
          });
          continue;
        }

        const effectiveOvercastForTarget = mr > 0 ? Math.max(0, overcast - mr) : overcast;
        targetOvercastById.set(target.actorId, effectiveOvercastForTarget);
      }

      validTargetActors = targetActors.filter((t) => !resistedByMr.has(t.actorId));
    }

    // From Beyond: immune to all MENTIS spells
    if (spell.discipline === "MENTIS" && validTargetActors.length > 0) {
      const immuneTargets = new Set<ActorId>();
      for (const target of validTargetActors) {
        if (target.actor.traits?.["trait:from_beyond"] !== undefined) {
          immuneTargets.add(target.actorId);
        }
      }
      if (immuneTargets.size > 0) {
        validTargetActors = validTargetActors.filter((t) => !immuneTargets.has(t.actorId));
        for (const targetId of immuneTargets) {
          const targetName = updatedSave.actorsById[targetId]?.name || targetId;
          updatedSave = appendCombatLog(updatedSave, `${targetName} è immune agli effetti mentali.`);
          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "system",
            message: `From Beyond: ${targetId} resists MENTIS spell ${spell.id}`,
            turnCounter: combat.turnCounter,
            resolutionId,
            tags: ["trait:from_beyond", "magic:discipline=MENTIS", `magic:spell=${spell.id}`],
          });
        }
      }
    }

    const getOvercastForTarget = (actorId: ActorId): number =>
      targetOvercastById.get(actorId) ?? overcast;

    // Handle opposed saves FIRST (before any effect application)
    // Filter out targets that successfully resist
    // Skip this block for combatDisarmAtRange - it handles its own opposed check
    if (effectDef.opposed && effectDef.specialOp !== "combatDisarmAtRange" && validTargetActors.length > 0) {
      const baseOpposedStat = effectDef.opposedStat || effectDef.castingStat;
      const opposedDifficulty = effectDef.opposedDifficulty || "Challenging";

      const resistedTargetIds = new Set<ActorId>();

      for (const target of validTargetActors) {
        // Deny the Witch talent: defender uses max(defenderStat, Will) for resistance
        const opposedStat = catalogs
          ? getBestResistStat(target.actor, baseOpposedStat, updatedSave, catalogs)
          : baseOpposedStat;

        // Magic Resistance talent: +10 to resist magic spells
        const magicResistanceBonus = catalogs 
          ? getResistanceBonus(updatedSave, catalogs, target.actorId, "magic")
          : 0;
        const untouchableDenyBonus = catalogs
          ? getUntouchableDenyBonus(updatedSave, catalogs, target.actorId)
          : 0;

        // Perform opposed check: caster's casting check result vs defender's resistance check
        const defenderCheck: SingleCheck = {
          id: `combat:cast:opposed:${spell.id}:${target.actorId}`,
          kind: "single",
          actorRef: { mode: "byId", actorId: target.actorId },
          key: opposedStat,
          difficulty: opposedDifficulty,
          modifier: magicResistanceBonus + untouchableDenyBonus, // Apply magic resistance + untouchable bonus
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

        // Check if Deny the Witch was used (defender used WIL instead of default stat)
        const usedDenyTheWitch = catalogs && opposedStat === "WIL" && baseOpposedStat !== "WIL" && 
          hasDenyTheWitch(target.actor, catalogs, save);

        if (attackerDoS > defenderDoS) {
          // Attacker wins - target is valid for effect application
          const targetName = target.actor.name || target.actorId;
          const statLabel = usedDenyTheWitch ? `${opposedStat} (Rifiuto della Strega)` : opposedStat;
          const opposedLog = `${targetName} resiste con ${statLabel} ma fallisce (DoS attaccante: ${attackerDoS}, DoS difensore: ${defenderDoS})`;
          updatedSave = appendCombatLog(updatedSave, opposedLog);
        } else {
          // Defender wins - spell fails against this target
          const targetName = target.actor.name || target.actorId;
          const statLabel = usedDenyTheWitch ? `${opposedStat} (Rifiuto della Strega)` : opposedStat;
          const resistedLog = `${targetName} resiste con successo usando ${statLabel} (DoS attaccante: ${attackerDoS}, DoS difensore: ${defenderDoS})`;
          updatedSave = appendCombatLog(updatedSave, resistedLog);

          // Mark as resisted
          resistedTargetIds.add(target.actorId);
        }
      }

      // Filter out resisted targets
      validTargetActors = validTargetActors.filter((t) => !resistedTargetIds.has(t.actorId));
    }

    // Deny the Witch check for NON-opposed spells
    // Targets with Deny the Witch may attempt a Will check to negate effects on themselves
    // Note: Resistance (Magic) applies to this check because it IS a magic resistance check
    if (!effectDef.opposed && validTargetActors.length > 0 && catalogs) {
      const resistedTargetIds = new Set<ActorId>();

      for (const target of validTargetActors) {
        // Only check if target has Deny the Witch talent
        if (!hasDenyTheWitch(target.actor, catalogs, save)) {
          continue;
        }

        // Resistance (Magic) talent applies to any spell resistance check
        // This is calculated separately from Deny the Witch - they are independent talents
        const magicResistanceBonus = getResistanceBonus(updatedSave, catalogs, target.actorId, "magic");
        const untouchableDenyBonus = getUntouchableDenyBonus(updatedSave, catalogs, target.actorId);

        // Perform Deny the Witch Will check (magic resistance is passed as additional modifier)
        const denyResult = performDenyTheWitchCheck(
          target.actor,
          effectiveDoS,
          updatedSave,
          rng,
          spell.id,
          catalogs,
          magicResistanceBonus + untouchableDenyBonus // Apply magic resistance + untouchable bonus
        );

        updatedSave = denyResult.save;

        const targetName = target.actor.name || target.actorId;
        if (denyResult.success) {
          // Defender successfully denied the spell effect
          const denyLog = `${targetName} nega gli effetti dell'incantesimo con Rifiuto della Strega!`;
          updatedSave = appendCombatLog(updatedSave, denyLog);
          resistedTargetIds.add(target.actorId);
        } else if (denyResult.checkResult) {
          // Defender attempted but failed
          const failLog = `${targetName} tenta di resistere con Rifiuto della Strega ma fallisce.`;
          updatedSave = appendCombatLog(updatedSave, failLog);
        }
      }

      // Filter out targets who successfully used Deny the Witch
      validTargetActors = validTargetActors.filter((t) => !resistedTargetIds.has(t.actorId));
    }

    // Force Field: block hostile spell effects before applying conditions or damage
    const shouldCheckForceField =
      effectDef.kind === "damage" || effectDef.kind === "fatigue" || effectDef.kind === "malediction";
    if (shouldCheckForceField && validTargetActors.length > 0) {
      const remainingTargets: typeof validTargetActors = [];
      for (const target of validTargetActors) {
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

        remainingTargets.push(target);
      }
      validTargetActors = remainingTargets;
    }

    // Apply damage/heal if effect has baseDamageDice
    // Skip if kind is "fatigue" (handled separately)
    // "blessing" and "malediction" effects should not have baseDamageDice (they use conditions/modifiers)
    // But if they do, we still process damage (e.g., kinesis_force_push has damage + condition)
    if (effectDef.baseDamageDice && effectDef.kind !== "fatigue" && validTargetActors.length > 0) {
      // Roll base damage dice once (overcast scaling is applied per target)
      const baseDice = effectDef.baseDamageDice;
      const diceCount = baseDice?.dice ?? 0;
      const diceSides = baseDice?.sides ?? 10;
      let damageRolls: number[] = [];
      let diceTotal = 0;
      for (let i = 0; i < diceCount; i++) {
        const roll = rng.nextInt(1, diceSides);
        damageRolls.push(roll);
        diceTotal += roll;
      }

      // Apply damage/heal to each target
      for (const target of validTargetActors) {
        const targetOvercast = getOvercastForTarget(target.actorId);
        const scaled = scaleDamage(effectDef.baseDamageDice, effectDef.baseDamageFlat, targetOvercast);
        const totalDamage = diceTotal + scaled.flatPlus;

        if (effectDef.kind === "heal") {
          // Healing: reduce wounds instead of applying damage
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

          // Log healing
          const formula = `${scaled.diceCount}d${scaled.diceSides}${
            scaled.flatPlus > 0 ? ` + ${scaled.flatPlus}` : ""
          }${targetOvercast > 0 ? ` (overcast +${targetOvercast * 2})` : ""}`;
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
              `magic:overcast=${targetOvercast}`,
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
          // Damage: bypasses armor, still applies TOU (daemonic bonus ignored for magical source)
          const baseTouBonus = getCharacteristicBonus(updatedSave, target.actorId, "TOU", catalogs);
          const daemonicParams = target.actor.traits?.["trait:daemonic"];
          const daemonicBonus =
            typeof daemonicParams === "object" && typeof daemonicParams.x === "number" ? daemonicParams.x : 0;
          const effectiveTouBonus = Math.max(0, baseTouBonus - daemonicBonus);
          const finalDamage = Math.max(0, totalDamage - effectiveTouBonus);

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

          // Log damage
          const formula = `${scaled.diceCount}d${scaled.diceSides}${
            scaled.flatPlus > 0 ? ` + ${scaled.flatPlus}` : ""
          }${targetOvercast > 0 ? ` (overcast +${targetOvercast * 2})` : ""}`;
          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "damage",
            attackerId: turnActorId,
            defenderId: target.actorId,
            formula,
            rolls: damageRolls,
            rawDamage: totalDamage,
            soak: 0,
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
          // Calculate HP before/after for logging
          const maxHpActual = catalogs
            ? calculateMaxHp(updatedSave, target.actor, catalogs)
            : target.actor.derived?.hpMax ?? 100;
          const woundsBefore = target.actor.resources.wounds ?? 0;
          const woundsAfter = damageResult.updatedActor.resources.wounds ?? 0;
          const hpBefore = maxHpActual - woundsBefore;
          const hpAfter = maxHpActual - woundsAfter;
          const damageLog = `${targetName} subisce ${finalDamage} danni (HP: ${hpBefore}→${hpAfter})`;
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
        const targetOvercast = getOvercastForTarget(target.actorId);

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
        const scaledDuration = effectDef.tempModifier.durationRounds + targetOvercast;
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

    // Apply conditions if effect has conditions
    if (effectDef.applyConditions && validTargetActors.length > 0) {
      for (const conditionSpec of effectDef.applyConditions) {
        for (const target of validTargetActors) {
          const targetOvercast = getOvercastForTarget(target.actorId);
          let finalStacks: number;
          let finalDuration: number | undefined;

          if (conditionSpec.conditionId === "force_field") {
            // Force Field: duration = base + overcast (base from durationRounds)
            const baseDuration = conditionSpec.durationRounds ?? 1;
            finalStacks = 1;
            finalDuration = baseDuration + targetOvercast;
          } else if (conditionSpec.conditionId === "force_shield") {
            // Force Shield: stacks = base + overcast, duration = base + overcast (base from durationRounds)
            const baseDuration = conditionSpec.durationRounds ?? 1;
            finalStacks = baseDuration + targetOvercast;
            finalDuration = baseDuration + targetOvercast;
          } else if (
            (conditionSpec.conditionId === "prone" || conditionSpec.conditionId === "fatigue") &&
            conditionSpec.durationRounds === undefined
          ) {
            // Prone/Fatigue without duration do not expire automatically
            const baseStacks = conditionSpec.value ?? 1;
            finalStacks = baseStacks + Math.floor(targetOvercast / 2);
            finalDuration = undefined;
          } else if (conditionSpec.conditionId === "steel_body" || conditionSpec.conditionId === "warp_speed") {
            // Steel Body / Warp Speed: stacks = 1 + overcast (for scaling bonuses)
            const scaled = scaleCondition(conditionSpec.value, conditionSpec.durationRounds, targetOvercast);
            finalStacks = 1 + targetOvercast;
            finalDuration = scaled.durationTurns;
          } else {
            // Other conditions: use normal scaling
            const scaled = scaleCondition(conditionSpec.value, conditionSpec.durationRounds, targetOvercast);
            finalStacks = scaled.stacks;
            finalDuration = scaled.durationTurns;
          }

          const untilTurnCounter =
            finalDuration === undefined ? undefined : combat.turnCounter + finalDuration;
          const spellSource = `spell:${spell.id}`;

          // Add condition
          let updatedTargetActor = addConditionToActor(
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
              : undefined
          );

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
          const durationLabel =
            finalDuration === undefined ? "permanente" : `${finalDuration} turni`;
          const conditionLog = `${targetName} ottiene ${conditionName} (stacks ${finalStacks}, durata ${durationLabel})`;
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
