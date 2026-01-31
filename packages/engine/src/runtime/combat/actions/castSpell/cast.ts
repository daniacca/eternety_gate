import type { Effect, GameSave, StoryPack, SingleCheck, CheckResult } from "../../../types";
import type { IRNG } from "../../../rng";
import { getCurrentTurnActorId } from "../../combat";
import { appendCombatLog, appendRuntimeLog, nextRuntimeSeq } from "../../narration";
import { performCheckWithSave } from "../../../checks";
import { getSpellById, getEffectById } from "../../../magic/catalogs";
import { getMagicPower } from "../../../magic/pm";
import { applyFatigue } from "../../../characters/fatigue";
import { getCharacteristicBonus } from "../../../characters/bonuses";
import { shouldTriggerPhenomena, getPhenomenaSeverity, rollPhenomena } from "../../../magic/phenomena";
import { hasLearnedSpell } from "../../../magic/learning";
import { hasUnlockedAction } from "../../../characters/actions";
import type { CharacterCatalogs } from "../../../../content/catalogs";
import { loadCharacterCatalogs } from "../../../../content/loadCatalogs";
import { buildSpellTargetSpec, computeTargetPreview } from "../../targeting/computeTargeting";
import type { TargetSpec, TargetSelection, TargetPreview } from "../../targeting/types";
import { hasTrait } from "../../../characters/prerequisites";
import { getUntouchableAuraImpact } from "../../untouchableAura";
import { applySpellEffectsForCast } from "./effects";
import { combatDoubleCastSpell } from "./doubleCast";

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

  if (effect.secondarySpellId) {
    return combatDoubleCastSpell(
      effect as Extract<Effect, { op: "combatCastSpell" }> & { secondarySpellId: string },
      storyPack,
      save,
      rng
    );
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
  if (actor.conditions?.beast_form) {
    const blockedCheck: CheckResult = {
      checkId: "combat:castSpell:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=beastForm"],
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

  const effectStatKey = effectDef.effectStat ?? effectDef.castingStat;
  const effectStatBonus = getCharacteristicBonus(currentSave, turnActorId, effectStatKey, catalogs);

  let targetSelection: TargetSelection = effect.targetSelection;
  const spellTargetSpec: TargetSpec = buildSpellTargetSpec(spell, effectDef, cnBase);
  if (effectDef.radiusFromEffectStat && spellTargetSpec.shape.kind === "radius") {
    spellTargetSpec.shape = {
      ...spellTargetSpec.shape,
      radius: Math.max(0, effectStatBonus),
    };
  }
  if (effectDef.centerOnCaster && spellTargetSpec.shape.kind === "radius") {
    const casterPos = currentSave.runtime.combat?.positions[turnActorId];
    if (casterPos) {
      targetSelection = { kind: "radius", centerPos: casterPos };
    }
  }

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
  const overcast = castOptions?.noOvercast ? 0 : Math.ceil(rawOvercast / 2);

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
    updatedSave = applySpellEffectsForCast({
      save: updatedSave,
      storyPack,
      rng,
      catalogs,
      combat,
      turnActorId,
      spell,
      effectDef,
      cnBase,
      effectiveDoS,
      overcast,
      resolutionId,
      targetSelection,
      phenomenaResult,
    });
  }

  // Update combat state with action economy consumption (already done above for failure case)
  updatedSave = {
    ...updatedSave,
    runtime: {
      ...updatedSave.runtime,
      combat: {
        ...updatedSave.runtime.combat!,
        turn: updatedCombat.turn,
        freeSpellUsedThisTurn: updatedCombat.freeSpellUsedThisTurn,
        channeling: updatedCombat.channeling,
      },
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

