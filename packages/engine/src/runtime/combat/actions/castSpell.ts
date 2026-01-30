import type { Effect, GameSave, StoryPack, SingleCheck, ActorId, CheckResult, StatKey } from "../../types";
import type { IRNG } from "../../rng";
import { calculateInitialMovement, getCurrentTurnActorId, updateAuraEffects } from "../combat";
import { appendCombatLog, appendRuntimeLog, nextRuntimeSeq } from "../narration";
import { performCheckWithSave } from "../../checks";
import { getSpellById, getEffectById } from "../../magic/catalogs";
import { getMagicPower } from "../../magic/pm";
import { applyFatigue } from "../../characters/fatigue";
import { getCharacteristicBonus } from "../../characters/bonuses";
import { shouldTriggerPhenomena, getPhenomenaSeverity, rollPhenomena } from "../../magic/phenomena";
import { hasLearnedSpell } from "../../magic/learning";
import { addConditionToActor, hasCondition, removeConditionFromActor } from "../../conditions";
import {
  addUnnaturalCharacteristics,
  addTraitsWithSource,
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
import { getResistanceBonus, hasTalentHook } from "../../characters/talentModifiers";
import { getMagicResistanceAgainstSpell } from "../../magic/resistance";
import { getUntouchableDenyBonus } from "../../characters/untouchable";
import { hasTrait } from "../../characters/prerequisites";
import { resolveForceFieldBlock } from "../forceField";
import { trackCombatDamage } from "../damageTracking";
import { getUntouchableAuraImpact } from "../untouchableAura";
import { canPlaceActorAt, getActorSize } from "../footprint";
import { getCellTerrain } from "../terrain";
import { getActorArmor } from "../equipment";
import type { ContentPack } from "../../../content/types";

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

function combatDoubleCastSpell(
  effect: Extract<Effect, { op: "combatCastSpell" }> & { secondarySpellId: string },
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
    const blockedCheck: CheckResult = {
      checkId: "combat:doubleCastSpell:blocked",
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

  const actor = save.actorsById[turnActorId];
  if (!actor) {
    return { save };
  }
  if (actor.conditions?.frenzy) {
    const blockedCheck: CheckResult = {
      checkId: "combat:doubleCastSpell:blocked",
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

  const primarySpell = getSpellById(effect.spellId);
  const secondarySpell = getSpellById(effect.secondarySpellId);
  if (!primarySpell || !secondarySpell) {
    return { save };
  }

  const primaryEffectDef = getEffectById(primarySpell.effectId);
  const secondaryEffectDef = getEffectById(secondarySpell.effectId);
  if (!primaryEffectDef || !secondaryEffectDef) {
    return { save };
  }

  const castOptions = effect.castOptions;

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

  if (catalogs && !castOptions?.ignoreWeaverRequirement && !hasUnlockedAction(save, catalogs, turnActorId, "magic:cast")) {
    const blockedCheck: CheckResult = {
      checkId: "combat:doubleCastSpell:blocked",
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

  if (catalogs && !hasUnlockedAction(save, catalogs, turnActorId, "magic:doubleCast")) {
    const blockedCheck: CheckResult = {
      checkId: "combat:doubleCastSpell:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=actionNotUnlocked", "magic:doubleCast=1"],
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
      message: "Non puoi lanciare un doppio incantesimo: azione non sbloccata.",
      turnCounter: combat.turnCounter,
    });
    return { save: updatedSave };
  }

  if (!hasLearnedSpell(actor, primarySpell.id)) {
    const blockedCheck: CheckResult = {
      checkId: "combat:doubleCastSpell:blocked",
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
      message: `Non conosci l'incantesimo: ${primarySpell.name}`,
      turnCounter: combat.turnCounter,
    });
    return { save: updatedSave };
  }

  if (!hasLearnedSpell(actor, secondarySpell.id)) {
    const blockedCheck: CheckResult = {
      checkId: "combat:doubleCastSpell:blocked",
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
      message: `Non conosci l'incantesimo: ${secondarySpell.name}`,
      turnCounter: combat.turnCounter,
    });
    return { save: updatedSave };
  }

  if (primaryEffectDef.kind !== secondaryEffectDef.kind) {
    const loggedSave = appendRuntimeLog(save, {
      kind: "system",
      message: "Il doppio incantesimo richiede due effetti dello stesso tipo.",
      turnCounter: combat.turnCounter,
    });
    return { save: loggedSave };
  }

  if (primarySpell.targetShape !== secondarySpell.targetShape) {
    const loggedSave = appendRuntimeLog(save, {
      kind: "system",
      message: "Il doppio incantesimo richiede due incantesimi con la stessa forma di bersaglio.",
      turnCounter: combat.turnCounter,
    });
    return { save: loggedSave };
  }

  const castTimeOrder: Record<string, number> = {
    free: 0,
    standard: 1,
    fullRound: 2,
  };
  const actionCastTime =
    castTimeOrder[primarySpell.castTime] >= castTimeOrder[secondarySpell.castTime]
      ? primarySpell.castTime
      : secondarySpell.castTime;

  if (actionCastTime === "free") {
    const freeSpellUsed = combat.freeSpellUsedThisTurn?.[turnActorId] ?? false;
    if (freeSpellUsed) {
      const blockedCheck: CheckResult = {
        checkId: "combat:doubleCastSpell:blocked",
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
    if (!combat.turn.actionAvailable) {
      const blockedCheck: CheckResult = {
        checkId: "combat:doubleCastSpell:blocked",
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

  if (actor.conditions?.shock && actionCastTime === "fullRound") {
    const blockedCheck: CheckResult = {
      checkId: "combat:doubleCastSpell:blocked",
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
        checkId: "combat:doubleCastSpell:blocked",
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
        checkId: "combat:doubleCastSpell:blocked",
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

  const channeling = combat.channeling;
  const channelDoS = channeling?.actorId === turnActorId ? channeling.accumulatedDoS : 0;

  const castingPenaltyModifier = actor.status.tempModifiers?.find((mod) => mod.id === "phenomena:castingPenalty");
  const hasCastingPenalty = !!castingPenaltyModifier;

  let auraPenalty = 0;
  if (catalogs && hasTrait(actor, "trait:weaver", save)) {
    const impact = getUntouchableAuraImpact(save, catalogs, turnActorId);
    if (impact) {
      auraPenalty = impact.penalty;
    }
  }

  const totalCN = primarySpell.baseCN + secondarySpell.baseCN;

  const castingCheck: SingleCheck = {
    id: `combat:doubleCast:${primarySpell.id}:${secondarySpell.id}:${turnActorId}`,
    kind: "single",
    actorRef: { mode: "byId", actorId: turnActorId },
    key: primaryEffectDef.castingStat,
    difficulty: "Challenging",
    modifier: auraPenalty !== 0 ? auraPenalty : undefined,
  };

  const { save: saveWithSeq, seq } = nextRuntimeSeq(currentSave);
  const resolutionId = `res:${seq}`;

  const { result, save: afterCheckSave } = performCheckWithSave(
    castingCheck,
    storyPack,
    saveWithSeq,
    rng,
    resolutionId
  );

  if (!result) {
    return {
      save: appendRuntimeLog(afterCheckSave, {
        kind: "system",
        message: "Errore nel controllo di doppio incantesimo",
        turnCounter: combat.turnCounter,
      }),
    };
  }

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

  const castDoS = result.dos;
  let effectiveDoS = castDoS + channelDoS;
  const baseSuccess = effectiveDoS >= totalCN;
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
  const rawOvercast = Math.max(0, effectiveDoS - totalCN);
  const overcast = castOptions?.noOvercast ? 0 : Math.ceil(rawOvercast / 2);

  const pm = getMagicPower(saveAfterPenaltyRemoval, turnActorId, catalogs);
  const phenomenaTriggered = shouldTriggerPhenomena(result);
  const phenomenaSeverity = phenomenaTriggered ? getPhenomenaSeverity(totalCN, pm, effectiveDoS) : null;

  let updatedSave = saveAfterPenaltyRemoval;

  const applyRfForSpell = (spellCn: number, effectDef: typeof primaryEffectDef): void => {
    let rfToApply = 0;
    if (success) {
      if (spellCn > pm) {
        rfToApply += 1;
      }
      if (phenomenaTriggered) {
        rfToApply += 1;
      }
      if (effectDef?.specialFatigue) {
        rfToApply += effectDef.specialFatigue;
      }
      if (effectDef?.rfOnSuccess) {
        rfToApply += effectDef.rfOnSuccess;
      }
    } else {
      if (spellCn > pm) {
        rfToApply += 1;
      }
      if (result.dof >= 2) {
        rfToApply += 2;
      }
      if (phenomenaTriggered) {
        rfToApply += 1;
      }
    }

    if (castOptions?.skipRfCost) {
      rfToApply = 0;
    }
    if (rfToApply > 0) {
      updatedSave = applyFatigue(updatedSave, turnActorId, rfToApply, catalogs);
    }
  };

  applyRfForSpell(primarySpell.baseCN, primaryEffectDef);
  applyRfForSpell(secondarySpell.baseCN, secondaryEffectDef);

  let phenomenaResult: { save: GameSave; kind: string; description: string } | null = null;
  if (phenomenaTriggered) {
    phenomenaResult = rollPhenomena(updatedSave, turnActorId, rng, catalogs);
    updatedSave = phenomenaResult.save;
    const phenomenaDesc = phenomenaResult.description;
    const severity = phenomenaSeverity || "mild";

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

  const updatedCombat = {
    ...updatedSave.runtime.combat!,
    turn: {
      ...updatedSave.runtime.combat!.turn,
      actionAvailable: actionCastTime === "free" ? updatedSave.runtime.combat!.turn.actionAvailable : false,
      moveRemaining: actionCastTime === "fullRound" ? 0 : updatedSave.runtime.combat!.turn.moveRemaining,
    },
    freeSpellUsedThisTurn: {
      ...(updatedSave.runtime.combat!.freeSpellUsedThisTurn || {}),
      ...(actionCastTime === "free" ? { [turnActorId]: true } : {}),
    },
    channeling: undefined,
  };

  if (!success) {
    const actorAfterCheck = updatedSave.actorsById[turnActorId] || actor;
    const actorName = actorAfterCheck.name || turnActorId;
    const failureLog =
      actorAfterCheck.kind === "PC"
        ? `Lanci Doppio Incantesimo: ${primarySpell.name} + ${secondarySpell.name} (CN ${totalCN}) → FALLIMENTO (DoF: ${result.dof})`
        : `${actorName} lancia Doppio Incantesimo: ${primarySpell.name} + ${secondarySpell.name} (CN ${totalCN}) → FALLIMENTO (DoF: ${result.dof})`;
    updatedSave = appendCombatLog(updatedSave, failureLog);

    updatedSave = {
      ...updatedSave,
      runtime: {
        ...updatedSave.runtime,
        combat: updatedCombat,
        lastCheck: {
          ...result,
          tags: [
            ...(result.tags || []),
            `magic:spell=${primarySpell.id}`,
            `magic:spell=${secondarySpell.id}`,
            `magic:effect=${primaryEffectDef.id}`,
            `magic:effect=${secondaryEffectDef.id}`,
            `magic:cn=${totalCN}`,
            `magic:dosTotal=${effectiveDoS}`,
            `magic:overcast=${overcast}`,
            `magic:kind=${primaryEffectDef.kind}`,
            "magic:doubleCast=1",
            ...(channelDoS > 0 ? [`magic:channelDoS=${channelDoS}`] : []),
          ],
        },
      },
    };

    return { save: updatedSave };
  }

  const actorAfterCheck = updatedSave.actorsById[turnActorId] || actor;
  const actorName = actorAfterCheck.name || turnActorId;
  const castSummaryLog =
    actorAfterCheck.kind === "PC"
      ? `Lanci Doppio Incantesimo: ${primarySpell.name} + ${secondarySpell.name} (CN ${totalCN}) → SUCCESSO (DoS: ${castDoS}${
          channelDoS > 0 ? ` + Channel: ${channelDoS}` : ""
        } = ${effectiveDoS}, Overcast: ${overcast})`
      : `${actorName} lancia Doppio Incantesimo: ${primarySpell.name} + ${secondarySpell.name} (CN ${totalCN}) → SUCCESSO (DoS: ${castDoS}${
          channelDoS > 0 ? ` + Channel: ${channelDoS}` : ""
        } = ${effectiveDoS}, Overcast: ${overcast})`;
  updatedSave = appendCombatLog(updatedSave, castSummaryLog);

  let sharedTargetSelection = targetSelection;
  if (phenomenaResult?.kind === "targetRandomization" && primarySpell.targetShape === "single") {
    const primaryTargetSpec = buildSpellTargetSpec(primarySpell, primaryEffectDef, primarySpell.baseCN);
    const secondaryTargetSpec = buildSpellTargetSpec(secondarySpell, secondaryEffectDef, secondarySpell.baseCN);
    const primaryRange = primaryTargetSpec.shape.kind === "single" ? primaryTargetSpec.shape.range : 0;
    const secondaryRange = secondaryTargetSpec.shape.kind === "single" ? secondaryTargetSpec.shape.range : 0;
    const rangeSquares = Math.min(primaryRange, secondaryRange);
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
          sharedTargetSelection = { kind: "single", targetPos: randomPos };
          const phenomenonMessage = "La Trama sfugge al controllo: il bersaglio cambia!";
          updatedSave = appendCombatLog(updatedSave, phenomenonMessage);
          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "system",
            message: phenomenonMessage,
            turnCounter: combat.turnCounter,
            resolutionId,
            tags: [
              "magic:phenomena=targetRandomization",
              "magic:doubleCast=1",
              `magic:spell=${primarySpell.id}`,
              `magic:spell=${secondarySpell.id}`,
              `magic:caster=${turnActorId}`,
              `magic:randomTarget=${randomTargetId}`,
              `magic:randomPos=${randomPos.x},${randomPos.y}`,
            ],
          });
        }
      }
    }
  }

  const casterPos = updatedSave.runtime.combat?.positions[turnActorId];
  if ((primaryEffectDef.centerOnCaster || secondaryEffectDef.centerOnCaster) && casterPos) {
    sharedTargetSelection = { kind: "radius", centerPos: casterPos };
  }

  const primaryTargetSpec = buildSpellTargetSpec(primarySpell, primaryEffectDef, primarySpell.baseCN);
  if (primaryEffectDef.radiusFromEffectStat && primaryTargetSpec.shape.kind === "radius") {
    const primaryEffectBonus = getCharacteristicBonus(
      updatedSave,
      turnActorId,
      primaryEffectDef.effectStat ?? primaryEffectDef.castingStat,
      catalogs
    );
    primaryTargetSpec.shape = {
      ...primaryTargetSpec.shape,
      radius: Math.max(0, primaryEffectBonus),
    };
  }
  const secondaryTargetSpec = buildSpellTargetSpec(secondarySpell, secondaryEffectDef, secondarySpell.baseCN);
  if (secondaryEffectDef.radiusFromEffectStat && secondaryTargetSpec.shape.kind === "radius") {
    const secondaryEffectBonus = getCharacteristicBonus(
      updatedSave,
      turnActorId,
      secondaryEffectDef.effectStat ?? secondaryEffectDef.castingStat,
      catalogs
    );
    secondaryTargetSpec.shape = {
      ...secondaryTargetSpec.shape,
      radius: Math.max(0, secondaryEffectBonus),
    };
  }
  const primaryTargetPreview = computeTargetPreview(updatedSave, turnActorId, primaryTargetSpec, sharedTargetSelection);
  const secondaryTargetPreview = computeTargetPreview(updatedSave, turnActorId, secondaryTargetSpec, sharedTargetSelection);

  if (!primaryTargetPreview.valid || !secondaryTargetPreview.valid) {
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: "Targeting non valido per il doppio incantesimo.",
      turnCounter: combat.turnCounter,
      resolutionId,
    });
    updatedSave = {
      ...updatedSave,
      runtime: {
        ...updatedSave.runtime,
        combat: updatedCombat,
        lastCheck: {
          ...result,
          tags: [
            ...(result.tags || []),
            `magic:spell=${primarySpell.id}`,
            `magic:spell=${secondarySpell.id}`,
            `magic:effect=${primaryEffectDef.id}`,
            `magic:effect=${secondaryEffectDef.id}`,
            `magic:cn=${totalCN}`,
            `magic:dosTotal=${effectiveDoS}`,
            `magic:overcast=${overcast}`,
            `magic:kind=${primaryEffectDef.kind}`,
            "magic:doubleCast=1",
            ...(channelDoS > 0 ? [`magic:channelDoS=${channelDoS}`] : []),
          ],
        },
      },
    };
    return { save: updatedSave };
  }

  updatedSave = applySpellEffectsForCast({
    save: updatedSave,
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell: primarySpell,
    effectDef: primaryEffectDef,
    cnBase: primarySpell.baseCN,
    effectiveDoS,
    overcast,
    resolutionId,
    targetSelection: sharedTargetSelection,
    phenomenaResult: null,
    skipPhenomenaTargetRandomization: true,
  });

  updatedSave = applySpellEffectsForCast({
    save: updatedSave,
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell: secondarySpell,
    effectDef: secondaryEffectDef,
    cnBase: secondarySpell.baseCN,
    effectiveDoS,
    overcast,
    resolutionId,
    targetSelection: sharedTargetSelection,
    phenomenaResult: null,
    skipPhenomenaTargetRandomization: true,
  });

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
          `magic:spell=${primarySpell.id}`,
          `magic:spell=${secondarySpell.id}`,
          `magic:effect=${primaryEffectDef.id}`,
          `magic:effect=${secondaryEffectDef.id}`,
          `magic:cn=${totalCN}`,
          `magic:dosTotal=${effectiveDoS}`,
          `magic:overcast=${overcast}`,
          `magic:kind=${primaryEffectDef.kind}`,
          "magic:doubleCast=1",
          ...(channelDoS > 0 ? [`magic:channelDoS=${channelDoS}`] : []),
        ],
      },
    },
  };

  return { save: updatedSave };
}

type SpellEffectApplyParams = {
  save: GameSave;
  storyPack: StoryPack;
  rng: IRNG;
  catalogs?: CharacterCatalogs;
  combat: NonNullable<GameSave["runtime"]["combat"]>;
  turnActorId: ActorId;
  spell: ReturnType<typeof getSpellById>;
  effectDef: ReturnType<typeof getEffectById>;
  cnBase: number;
  effectiveDoS: number;
  overcast: number;
  resolutionId: string;
  targetSelection: TargetSelection;
  phenomenaResult?: { save: GameSave; kind: string; description: string } | null;
  skipPhenomenaTargetRandomization?: boolean;
};

function applySpellEffectsForCast(params: SpellEffectApplyParams): GameSave {
  let updatedSave = params.save;
  const {
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
    phenomenaResult,
    skipPhenomenaTargetRandomization,
  } = params;
  let targetSelection: TargetSelection = params.targetSelection;

  if (!spell || !effectDef) {
    return updatedSave;
  }

  const effectStatKey = effectDef.effectStat ?? effectDef.castingStat;
  const effectStatBonus = getCharacteristicBonus(updatedSave, turnActorId, effectStatKey, catalogs);
  const terrainContentPack: ContentPack | undefined =
    storyPack.grids || storyPack.tiles
      ? {
          id: storyPack.id,
          grids: storyPack.grids,
          tiles: storyPack.tiles,
        }
      : undefined;

  const spellTargetSpec = buildSpellTargetSpec(spell, effectDef, cnBase);
  if (effectDef.radiusFromEffectStat && spellTargetSpec.shape.kind === "radius") {
    spellTargetSpec.shape = {
      ...spellTargetSpec.shape,
      radius: Math.max(0, effectStatBonus),
    };
  }
  if (effectDef.centerOnCaster && spellTargetSpec.shape.kind === "radius") {
    const casterPos = updatedSave.runtime.combat?.positions[turnActorId];
    if (casterPos) {
      targetSelection = { kind: "radius", centerPos: casterPos };
    }
  }

  let targetPreview: TargetPreview = computeTargetPreview(updatedSave, turnActorId, spellTargetSpec, targetSelection);

  if (!skipPhenomenaTargetRandomization && phenomenaResult?.kind === "targetRandomization" && spellTargetSpec.shape.kind === "single") {
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
          targetSelection = randomizedSelection;
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
    return updatedSave;
  }

  let targetActors = targetPreview.affectedActorIds
    .map((id) => ({
      actorId: id,
      actor: updatedSave.actorsById[id],
    }))
    .filter((t): t is { actorId: ActorId; actor: NonNullable<typeof updatedSave.actorsById[string]> } => !!t.actor);

  if (effectDef.aura?.applyToAllies && effectDef.aura.includeCaster !== false) {
    if (!targetActors.some((target) => target.actorId === turnActorId)) {
      const casterActor = updatedSave.actorsById[turnActorId];
      if (casterActor) {
        targetActors = [{ actorId: turnActorId, actor: casterActor }, ...targetActors];
      }
    }
  }

  const partyIds = new Set(updatedSave.party?.actors ?? []);
  const isAlly = (casterId: ActorId, targetId: ActorId): boolean => {
    const casterIsParty = partyIds.has(casterId);
    return casterIsParty ? partyIds.has(targetId) : !partyIds.has(targetId);
  };

  if (
    effectDef.aura?.applyToAllies ||
    effectDef.specialOp === "combatPurgeConditions"
  ) {
    targetActors = targetActors.filter((t) => isAlly(turnActorId, t.actorId));
  }

  if (effectDef.specialOp === "combatControlMind" || effectDef.specialOp === "combatVisionOfTerror") {
    targetActors = targetActors.filter((t) => !isAlly(turnActorId, t.actorId));
  }

  // Log target resolution
  if (targetActors.length > 0) {
    const targetNames = targetActors.map((t) => t.actor.name || t.actorId).join(", ");
    const targetLog = `Bersagli: ${targetNames}`;
    updatedSave = appendCombatLog(updatedSave, targetLog);
  }

  // Initialize valid targets (will be filtered by opposed saves if needed)
  let validTargetActors = [...targetActors];

  const targetOvercastById = new Map<ActorId, number>();
  const manifestedPM = cnBase + overcast;

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
  if (
    effectDef.opposed &&
    effectDef.specialOp !== "combatDisarmAtRange" &&
    effectDef.specialOp !== "combatHaemorrhage" &&
    effectDef.specialOp !== "combatControlMind" &&
    effectDef.specialOp !== "combatVisionOfTerror" &&
    validTargetActors.length > 0
  ) {
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
        hasDenyTheWitch(target.actor, catalogs, updatedSave);

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
      if (!hasDenyTheWitch(target.actor, catalogs, updatedSave)) {
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

  if (effectDef.specialOp === "combatPurgeConditions" && validTargetActors.length > 0) {
    const badConditions = new Set([
      "stunned",
      "bleeding",
      "fatigue",
      "unconscious",
      "bound",
      "halvedMovement",
      "prone",
      "misfortune",
      "shock",
      "force_field_overload",
    ]);
    for (const target of validTargetActors) {
      let updatedActor = target.actor;
      if (updatedActor.conditions) {
        for (const conditionId of Object.keys(updatedActor.conditions)) {
          if (badConditions.has(conditionId)) {
            updatedActor = removeConditionFromActor(updatedActor, conditionId as any);
          }
        }
      }
      if (updatedActor.status?.tempModifiers?.length) {
        const filteredMods = updatedActor.status.tempModifiers.filter((mod) => mod.value >= 0);
        if (filteredMods.length !== updatedActor.status.tempModifiers.length) {
          updatedActor = {
            ...updatedActor,
            status: {
              ...updatedActor.status,
              tempModifiers: filteredMods,
            },
          };
        }
      }
      if (updatedActor !== target.actor) {
        updatedSave = {
          ...updatedSave,
          actorsById: {
            ...updatedSave.actorsById,
            [target.actorId]: updatedActor,
          },
        };
        const targetName = target.actor.name || target.actorId;
        updatedSave = appendCombatLog(updatedSave, `${targetName} viene purificato dalle condizioni negative.`);
      }
    }
    return updatedSave;
  }

  if (effectDef.specialOp === "combatHaemorrhage" && validTargetActors.length > 0) {
    const resistedTargetIds = new Set<ActorId>();
    const baseOpposedStat = effectDef.opposedStat || "TOU";
    const opposedDifficulty = effectDef.opposedDifficulty || "Challenging";

    for (const target of validTargetActors) {
      const opposedStat = catalogs
        ? getBestResistStat(target.actor, baseOpposedStat, updatedSave, catalogs)
        : baseOpposedStat;
      const magicResistanceBonus = catalogs ? getResistanceBonus(updatedSave, catalogs, target.actorId, "magic") : 0;
      const untouchableDenyBonus = catalogs ? getUntouchableDenyBonus(updatedSave, catalogs, target.actorId) : 0;
      const targetOvercast = getOvercastForTarget(target.actorId);
      const resistPenalty = -10 * targetOvercast;

      const defenderCheck: SingleCheck = {
        id: `combat:cast:haemorrhage:${spell.id}:${target.actorId}`,
        kind: "single",
        actorRef: { mode: "byId", actorId: target.actorId },
        key: opposedStat,
        difficulty: opposedDifficulty,
        modifier: magicResistanceBonus + untouchableDenyBonus + resistPenalty,
      };

      const { result: defenderResult, save: saveAfterDefenderCheck } = performCheckWithSave(
        defenderCheck,
        storyPack,
        updatedSave,
        rng,
        `res:haemorrhage:${spell.id}:${target.actorId}`
      );

      updatedSave = saveAfterDefenderCheck;

      if (!defenderResult) {
        resistedTargetIds.add(target.actorId);
        continue;
      }

      const attackerDoS = effectiveDoS;
      const defenderDoS = defenderResult.success ? defenderResult.dos : -1;

      if (attackerDoS > defenderDoS) {
        const damage = Math.max(0, effectStatBonus + defenderResult.dof);
        const damageResult = applyDamageToActor(target.actor, damage, updatedSave, rng, storyPack, catalogs);
        updatedSave = {
          ...updatedSave,
          actorsById: {
            ...updatedSave.actorsById,
            [target.actorId]: damageResult.updatedActor,
          },
        };
        updatedSave = appendCombatLog(
          updatedSave,
          `${target.actor.name || target.actorId} subisce Emorragia (${damage} danni).`
        );
        updatedSave = appendRuntimeLog(updatedSave, {
          kind: "damage",
          attackerId: turnActorId,
          defenderId: target.actorId,
          formula: `WIL bonus + DoF (${effectStatBonus} + ${defenderResult.dof})`,
          rolls: [],
          rawDamage: damage,
          soak: 0,
          finalDamage: damage,
          turnCounter: combat.turnCounter,
          resolutionId,
          tags: [
            `magic:spell=${spell.id}`,
            `magic:effect=${effectDef.id}`,
            `magic:cn=${cnBase}`,
            `magic:dosTotal=${effectiveDoS}`,
            `magic:overcast=${targetOvercast}`,
            `magic:kind=${effectDef.kind}`,
            "magic:haemorrhage=1",
          ],
        });
      } else {
        resistedTargetIds.add(target.actorId);
        const targetName = target.actor.name || target.actorId;
        const resistedLog = `${targetName} resiste all'emorragia (${opposedStat}).`;
        updatedSave = appendCombatLog(updatedSave, resistedLog);
      }
    }

    validTargetActors = validTargetActors.filter((t) => !resistedTargetIds.has(t.actorId));
    return updatedSave;
  }

  if (effectDef.specialOp === "combatControlMind" && validTargetActors.length > 0) {
    const resistedTargetIds = new Set<ActorId>();
    const baseOpposedStat = effectDef.opposedStat || "WIL";
    const opposedDifficulty = effectDef.opposedDifficulty || "Challenging";

    for (const target of validTargetActors) {
      const opposedStat = catalogs
        ? getBestResistStat(target.actor, baseOpposedStat, updatedSave, catalogs)
        : baseOpposedStat;
      const magicResistanceBonus = catalogs ? getResistanceBonus(updatedSave, catalogs, target.actorId, "magic") : 0;
      const untouchableDenyBonus = catalogs ? getUntouchableDenyBonus(updatedSave, catalogs, target.actorId) : 0;
      const targetOvercast = getOvercastForTarget(target.actorId);
      const resistPenalty = -10 * targetOvercast;

      const defenderCheck: SingleCheck = {
        id: `combat:cast:controlMind:${spell.id}:${target.actorId}`,
        kind: "single",
        actorRef: { mode: "byId", actorId: target.actorId },
        key: opposedStat,
        difficulty: opposedDifficulty,
        modifier: magicResistanceBonus + untouchableDenyBonus + resistPenalty,
      };

      const { result: defenderResult, save: saveAfterDefenderCheck } = performCheckWithSave(
        defenderCheck,
        storyPack,
        updatedSave,
        rng,
        `res:controlMind:${spell.id}:${target.actorId}`
      );

      updatedSave = saveAfterDefenderCheck;

      if (!defenderResult) {
        resistedTargetIds.add(target.actorId);
        continue;
      }

      const attackerDoS = effectiveDoS;
      const defenderDoS = defenderResult.success ? defenderResult.dos : -1;

      if (attackerDoS > defenderDoS) {
        const duration = Math.max(1, effectStatBonus + targetOvercast);
        const untilTurnCounter = combat.turnCounter + duration;
        const spellSource = `spell:${spell.id}`;
        let updatedTargetActor = addConditionToActor(
          target.actor,
          "mind_control",
          1,
          untilTurnCounter,
          spellSource,
          { addedToParty: true }
        );

        const partyActors = updatedSave.party?.actors ?? [];
        const alreadyInParty = partyActors.includes(target.actorId);
        updatedSave = {
          ...updatedSave,
          actorsById: {
            ...updatedSave.actorsById,
            [target.actorId]: updatedTargetActor,
          },
          party: {
            ...updatedSave.party,
            actors: alreadyInParty ? partyActors : [...partyActors, target.actorId],
            activeActorId:
              updatedSave.party.activeActorId && updatedSave.party.activeActorId !== target.actorId
                ? updatedSave.party.activeActorId
                : updatedSave.party.activeActorId ?? turnActorId,
          },
        };
        updatedSave = appendCombatLog(
          updatedSave,
          `${target.actor.name || target.actorId} è sotto il tuo controllo.`
        );
      } else {
        resistedTargetIds.add(target.actorId);
        const targetName = target.actor.name || target.actorId;
        const resistedLog = `${targetName} resiste al controllo mentale (${opposedStat}).`;
        updatedSave = appendCombatLog(updatedSave, resistedLog);
      }
    }

    validTargetActors = validTargetActors.filter((t) => !resistedTargetIds.has(t.actorId));
    return updatedSave;
  }

  if (effectDef.specialOp === "combatVisionOfTerror" && validTargetActors.length > 0) {
    for (const target of validTargetActors) {
      if (target.actor.traits?.["trait:from_beyond"] !== undefined) {
        continue;
      }
      if (catalogs && hasTalentHook(target.actor, catalogs, "jaded")) {
        continue;
      }
      if (target.actor.conditions?.frenzy !== undefined) {
        continue;
      }
      const targetOvercast = getOvercastForTarget(target.actorId);
      const fearPenalty = -(5 * effectStatBonus + 5 * targetOvercast);
      const fearCheck: SingleCheck = {
        id: `combat:visionTerror:${spell.id}:${target.actorId}`,
        kind: "single",
        actorRef: { mode: "byId", actorId: target.actorId },
        key: "WIL",
        difficulty: "Challenging",
        modifier: fearPenalty,
      };
      const { result: fearResult, save: saveAfterFearCheck } = performCheckWithSave(
        fearCheck,
        storyPack,
        updatedSave,
        rng,
        `res:visionTerror:${spell.id}:${target.actorId}`
      );
      updatedSave = saveAfterFearCheck;
      if (!fearResult?.success) {
        const shockedActor = addConditionToActor(
          updatedSave.actorsById[target.actorId],
          "shock",
          1,
          undefined,
          `spell:${spell.id}`
        );
        updatedSave = {
          ...updatedSave,
          actorsById: {
            ...updatedSave.actorsById,
            [target.actorId]: shockedActor,
          },
        };
        const fearLog =
          target.actor.kind === "PC"
            ? "Sei sopraffatto dal terrore e resti sotto shock."
            : `${target.actor.name || target.actorId} è sopraffatto dal terrore e resta sotto shock.`;
        updatedSave = appendCombatLog(updatedSave, fearLog);
      }
    }
    return updatedSave;
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
      const rollMode = getMagicRollMode(updatedSave.actorsById[turnActorId]);
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
        const useSecond =
          rollMode === "best" ? second.total > first.total : second.total < first.total;
        const chosen = useSecond ? second : first;
        damageRolls = chosen.rolls;
        diceTotal = chosen.total;
      }

    // Apply damage/heal to each target
    for (const target of validTargetActors) {
      const targetOvercast = getOvercastForTarget(target.actorId);
      const baseDamageFlat = (effectDef.baseDamageFlat ?? 0) + effectStatBonus;
      const scaled = scaleDamage(effectDef.baseDamageDice, baseDamageFlat, targetOvercast);
      let totalDamage = diceTotal + scaled.flatPlus;
      if (
        effectDef.kind === "damage" &&
        effectDef.damageType === "energy" &&
        hasCondition(target.actor, "fiery_form")
      ) {
        totalDamage = Math.ceil(totalDamage / 2);
      }

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

        if (effectDef.healFatigueRatio && healed > 0) {
          const fatigueAmount = Math.ceil(healed * effectDef.healFatigueRatio);
          if (fatigueAmount > 0) {
            updatedSave = applyFatigue(updatedSave, turnActorId, fatigueAmount, catalogs);
            const casterName = updatedSave.actorsById[turnActorId]?.name || turnActorId;
            updatedSave = appendCombatLog(
              updatedSave,
              `${casterName} accumula ${fatigueAmount} Fatigue (tassazione della cura).`
            );
          }
        }
      } else {
        // Damage: impact applies armor + TOU, other types bypass armor
        const baseTouBonus = getCharacteristicBonus(updatedSave, target.actorId, "TOU", catalogs);
        let effectiveTouBonus = baseTouBonus;
        if (effectDef.damageType !== "impact") {
          const daemonicParams = target.actor.traits?.["trait:daemonic"];
          const daemonicBonus =
            typeof daemonicParams === "object" && typeof daemonicParams.x === "number" ? daemonicParams.x : 0;
          effectiveTouBonus = Math.max(0, baseTouBonus - daemonicBonus);
        }
        let armorSoak =
          effectDef.damageType === "impact" ? getActorArmor(updatedSave, target.actor).soak : 0;
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
            const weaponName = updatedSave.weaponsById?.[defenderWeaponId]?.name || "l'arma";
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
        effectDef.tempModifier.fixedDurationRounds ??
        effectDef.tempModifier.durationRounds + effectStatBonus;
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
          tags: [
            `magic:spell=${spell.id}`,
            `magic:effect=${effectDef.id}`,
            "magic:forcedMoveImpact=1",
          ],
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

function getMagicRollMode(actor: { conditions?: Partial<Record<string, any>> } | undefined): "best" | "worst" | "normal" {
  if (!actor) return "normal";
  const hasPrecognition = hasCondition(actor as any, "precognition");
  const hasMisfortune = hasCondition(actor as any, "misfortune");
  if (hasPrecognition && !hasMisfortune) return "best";
  if (hasMisfortune && !hasPrecognition) return "worst";
  return "normal";
}
