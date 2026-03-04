import type { Effect, GameSave, StoryPack, SingleCheck } from "../../../types";
import type { IRNG } from "../../../rng";
import { getCurrentTurnActorId } from "../../combat";
import { appendCombatLog, appendRuntimeLog, nextRuntimeSeq } from "../../narration";
import { performCheckWithSave } from "../../../checks";
import { getSpellById, getEffectById } from "../../../magic/catalogs";
import { getMagicPower } from "../../../magic/pm";
import { getMcMax, getMcCurrent, setMcCurrent, ensureMcReserve } from "../../../magic/od";
import { getMcSpentForMode, getCastModifierForMode, getOvercastLevel } from "../../../magic/castModes";
import { getMagicDensity, channelDoSToMc } from "../../../magic/density";
import { getEffectiveMagicDensity } from "../../untouchableAura";
import { applyFatigue } from "../../../characters/fatigue";
import { getCharacteristicBonus } from "../../../characters/bonuses";
import { getPhenomenaTrigger, getPhenomenaSeverityFromDof, getPhenomenaSeverity, rollPhenomena } from "../../../magic/phenomena";
import { hasLearnedSpell } from "../../../magic/learning";
import { hasUnlockedAction } from "../../../characters/actions";
import type { CharacterCatalogs } from "../../../../content/catalogs";
import { loadCharacterCatalogs } from "../../../../content/loadCatalogs";
import { buildSpellTargetSpec, computeTargetPreview } from "../../../targeting/computeTargeting";
import type { TargetSpec, TargetSelection, TargetPreview } from "../../../targeting/core/types";
import { hasTrait } from "../../../characters/prerequisites";
import { getUntouchableAuraImpact } from "../../untouchableAura";
import { getModifierTotal } from "../../../characters/modifiers";
import { getCastingSpecializationBonus } from "../../../characters/talentModifiers";
import { applySpellEffectsForCast } from "./effects";
import { combatDoubleCastSpell } from "./doubleCast";
import { applyBlockedCheck, buildBlockedCheck } from "./blockedCheck";

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
    const blockedCheck = buildBlockedCheck("combat:castSpell:blocked", effect.actorId, [
      "combat:blocked=notYourTurn",
      `combat:turn=${turnActorId || "unknown"}`,
    ]);
    return {
      save: applyBlockedCheck(save, blockedCheck),
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
    const blockedCheck = buildBlockedCheck("combat:castSpell:blocked", turnActorId, ["combat:blocked=frenzy"]);
    return {
      save: applyBlockedCheck(save, blockedCheck),
    };
  }
  if (actor.conditions?.beast_form) {
    const blockedCheck = buildBlockedCheck("combat:castSpell:blocked", turnActorId, ["combat:blocked=beastForm"]);
    return {
      save: applyBlockedCheck(save, blockedCheck),
    };
  }

  const cnBase = spell.baseCN;
  const fromScroll = castOptions?.fromScroll === true;

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
    const blockedCheck = buildBlockedCheck("combat:castSpell:blocked", turnActorId, ["combat:blocked=noMagicGate"]);
    return {
      save: applyBlockedCheck(save, blockedCheck, {
        message: "Non puoi lanciare incantesimi: ti manca il tratto magico necessario.",
        turnCounter: combat.turnCounter,
      }),
    };
  }

  // Check if spell is learned
  if (!hasLearnedSpell(actor, effect.spellId)) {
    const blockedCheck = buildBlockedCheck("combat:castSpell:blocked", turnActorId, ["combat:blocked=spellNotLearned"]);
    return {
      save: applyBlockedCheck(save, blockedCheck, {
        message: `Non conosci l'incantesimo: ${spell.name}`,
        turnCounter: combat.turnCounter,
      }),
    };
  }

  // Check action economy
  if (spell.castTime === "free") {
    // Free spell: check if already used this turn
    const freeSpellUsed = combat.freeSpellUsedThisTurn?.[turnActorId] ?? false;
    if (freeSpellUsed) {
      return {
        save: applyBlockedCheck(
          save,
          buildBlockedCheck("combat:castSpell:blocked", turnActorId, ["combat:blocked=freeSpellUsed"])
        ),
      };
    }
  } else {
    // Standard or Full Round: check action availability
    if (!combat.turn.actionAvailable) {
      return {
        save: applyBlockedCheck(
          save,
          buildBlockedCheck("combat:castSpell:blocked", turnActorId, ["combat:blocked=noAction"])
        ),
      };
    }
  }

  const shockedActor = save.actorsById[turnActorId];
  if (shockedActor?.conditions?.shock && spell.castTime === "fullRound") {
    return {
      save: applyBlockedCheck(
        save,
        buildBlockedCheck("combat:castSpell:blocked", turnActorId, ["combat:blocked=shock"])
      ),
    };
  }

  let currentSave = save;
  if (castOptions?.magicConduct) {
    if (catalogs && !hasUnlockedAction(save, catalogs, turnActorId, "magic:conduct")) {
      return {
        save: applyBlockedCheck(
          save,
          buildBlockedCheck("combat:castSpell:blocked", turnActorId, [
            "combat:blocked=actionNotUnlocked",
            "magic:conduct=1",
          ])
        ),
      };
    }
    const fatePoints = actor.resources.fatePoints ?? 0;
    if (fatePoints <= 0) {
      return {
        save: applyBlockedCheck(
          save,
          buildBlockedCheck("combat:castSpell:blocked", turnActorId, [
            "combat:blocked=noFatePoint",
            "magic:conduct=1",
          ])
        ),
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

  // Ensure MC reserve for caster (migration)
  if (catalogs) {
    currentSave = ensureMcReserve(currentSave, turnActorId, catalogs);
  }
  const actorWithMc = currentSave.actorsById[turnActorId]!;
  const pm = getMagicPower(currentSave, turnActorId, catalogs);
  const mode = castOptions?.castMode ?? "FETTERED";
  const mcSpent = getMcSpentForMode(mode, cnBase, pm);
  const mcMax = getMcMax(currentSave, turnActorId, catalogs);
  const currentMc = getMcCurrent(actorWithMc, mcMax);
  const baseDensity = getMagicDensity(currentSave);
  const density = catalogs ? getEffectiveMagicDensity(currentSave, catalogs, turnActorId, baseDensity) : baseDensity;
  const channeling = currentSave.runtime.combat?.channeling;
  const channelDoS = channeling?.actorId === turnActorId ? channeling.accumulatedDoS : 0;
  const mcFromMana = channelDoSToMc(channelDoS, density);
  const availableMc = mcFromMana + currentMc;
  if (!fromScroll && availableMc < mcSpent) {
    const saveWithChannelCleared = {
      ...currentSave,
      runtime: {
        ...currentSave.runtime,
        combat: currentSave.runtime.combat
          ? { ...currentSave.runtime.combat, channeling: undefined }
          : undefined,
      },
    };
    return {
      save: applyBlockedCheck(saveWithChannelCleared, buildBlockedCheck("combat:castSpell:blocked", turnActorId, [
        "combat:blocked=insufficientMC",
        `magic:mcRequired=${mcSpent}`,
        `magic:mcAvailable=${availableMc}`,
      ]), {
        message: `MC insufficienti (servono ${mcSpent}, disponibili ${availableMc}).`,
        turnCounter: combat.turnCounter,
      }),
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

  // Channel DoS (for log display); mcFromMana already computed above for availability

  // Check for casting penalty from phenomena (will be consumed after check)
  // Use stable ID "phenomena:castingPenalty"
  const castingPenaltyModifier = actor.status.tempModifiers?.find((mod) => mod.id === "phenomena:castingPenalty");
  const hasCastingPenalty = !!castingPenaltyModifier;

  // Untouchable aura penalty applies when a weaver casts within the aura
  let auraPenalty = 0;
  if (catalogs && hasTrait(actorWithMc, "trait:weaver", currentSave)) {
    const impact = getUntouchableAuraImpact(currentSave, catalogs, turnActorId);
    if (impact) {
      auraPenalty = impact.penalty;
    }
  }
  const flatCastBonus = catalogs ? getModifierTotal(currentSave, catalogs, turnActorId, "magic.castBonus") : 0;
  const discipline = (effectDef as { discipline?: string }).discipline;
  const disciplineCastBonus =
    catalogs && discipline && ["PYRA", "KINESIS", "MENTIS", "VATES", "CORPUS"].includes(discipline)
      ? getCastingSpecializationBonus(currentSave, catalogs, turnActorId, discipline as "PYRA" | "KINESIS" | "MENTIS" | "VATES" | "CORPUS")
      : 0;
  const castModifier =
    getCastModifierForMode(pm, fromScroll ? cnBase : mcSpent) + auraPenalty + flatCastBonus + disciplineCastBonus;

  // Create casting check
  const castingCheck: SingleCheck = {
    id: `combat:cast:${spell.id}:${turnActorId}`,
    kind: "single",
    actorRef: { mode: "byId", actorId: turnActorId },
    key: effectDef.castingStat,
    difficulty: "Challenging",
    modifier: castModifier !== 0 ? castModifier : undefined,
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

  // Success = check passed (no DoS gate)
  const success = result.success;
  const castDoS = result.dos;
  const effectiveDoS = castDoS + channelDoS;
  // Magic Conduct: add +1d5 MC to this cast (increases overcast and amount deducted)
  const magicConductBonus = success && castOptions?.magicConduct ? rng.nextInt(1, 5) : 0;
  if (magicConductBonus > 0) {
    saveAfterPenaltyRemoval = appendRuntimeLog(saveAfterPenaltyRemoval, {
      kind: "system",
      message: `Magic Conduct: +${magicConductBonus} MC (potenziale overcast)`,
      turnCounter: combat.turnCounter,
      resolutionId,
      tags: ["magic:conduct", `mcBonus=${magicConductBonus}`],
    });
  }
  const effectiveMcSpent = fromScroll ? 0 : mcSpent + magicConductBonus;
  const overcast =
    fromScroll || castOptions?.noOvercast ? 0 : getOvercastLevel(effectiveMcSpent, cnBase);

  if (!fromScroll) {
    const mcFromManaUsed = Math.min(effectiveMcSpent, mcFromMana);
    const mcFromOd = effectiveMcSpent - mcFromManaUsed;
    const casterForMc = saveAfterPenaltyRemoval.actorsById[turnActorId];
    const mcAfterCheck = casterForMc ? getMcCurrent(casterForMc, mcMax) : currentMc;
    saveAfterPenaltyRemoval = setMcCurrent(saveAfterPenaltyRemoval, turnActorId, mcAfterCheck - mcFromOd, mcMax);
  }

  const phenomenaTriggered = getPhenomenaTrigger(mode, result);
  const phenomenaSeverityTier =
    phenomenaTriggered && result.dof >= 2
      ? getPhenomenaSeverityFromDof(result.dof, mode)
      : phenomenaTriggered
        ? ("mild" as const)
        : null;
  const phenomenaSeverity = phenomenaTriggered ? (phenomenaSeverityTier === "major" || phenomenaSeverityTier === "moderate" ? "severe" : "mild") : null;
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
    const severityForRoll =
      phenomenaSeverityTier && phenomenaSeverityTier !== "mild" ? phenomenaSeverityTier : undefined;
    phenomenaResult = rollPhenomena(updatedSave, turnActorId, rng, catalogs, severityForRoll);
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
            `magic:mcSpent=${effectiveMcSpent}`,
            `magic:castMode=${mode}`,
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
    const emittedMC = fromScroll ? cnBase : effectiveMcSpent;
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
      emittedMC,
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
          `magic:mcSpent=${effectiveMcSpent}`,
          `magic:castMode=${mode}`,
          `magic:kind=${effectDef.kind}`,
          ...(channelDoS > 0 ? [`magic:channelDoS=${channelDoS}`] : []),
        ],
      },
    },
  };

  return { save: updatedSave };
}

