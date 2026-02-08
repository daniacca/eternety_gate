import type { Effect, GameSave, StoryPack, SingleCheck } from "../../../types";
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
import { buildSpellTargetSpec, computeTargetPreview } from "../../../targeting/computeTargeting";
import { getActorsInRange } from "../../../targeting/getActorsInRange";
import type { TargetSelection } from "../../../targeting/core/types";
import { hasTrait } from "../../../characters/prerequisites";
import { getUntouchableAuraImpact } from "../../untouchableAura";
import { applySpellEffectsForCast } from "./effects";
import { applyBlockedCheck, buildBlockedCheck } from "./blockedCheck";

export function combatDoubleCastSpell(
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
    return {
      save: applyBlockedCheck(
        save,
        buildBlockedCheck("combat:doubleCastSpell:blocked", effect.actorId, [
          "combat:blocked=notYourTurn",
          `combat:turn=${turnActorId || "unknown"}`,
        ])
      ),
    };
  }

  const actor = save.actorsById[turnActorId];
  if (!actor) {
    return { save };
  }
  if (actor.conditions?.frenzy) {
    return {
      save: applyBlockedCheck(
        save,
        buildBlockedCheck("combat:doubleCastSpell:blocked", turnActorId, ["combat:blocked=frenzy"])
      ),
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
    const blockedCheck = buildBlockedCheck("combat:doubleCastSpell:blocked", turnActorId, ["combat:blocked=noMagicGate"]);
    return {
      save: applyBlockedCheck(save, blockedCheck, {
        message: "Non puoi lanciare incantesimi: ti manca il tratto magico necessario.",
        turnCounter: combat.turnCounter,
      }),
    };
  }

  if (catalogs && !hasUnlockedAction(save, catalogs, turnActorId, "magic:doubleCast")) {
    const blockedCheck = buildBlockedCheck("combat:doubleCastSpell:blocked", turnActorId, [
      "combat:blocked=actionNotUnlocked",
      "magic:doubleCast=1",
    ]);
    return {
      save: applyBlockedCheck(save, blockedCheck, {
        message: "Non puoi lanciare un doppio incantesimo: azione non sbloccata.",
        turnCounter: combat.turnCounter,
      }),
    };
  }

  if (!hasLearnedSpell(actor, primarySpell.id)) {
    const blockedCheck = buildBlockedCheck("combat:doubleCastSpell:blocked", turnActorId, ["combat:blocked=spellNotLearned"]);
    return {
      save: applyBlockedCheck(save, blockedCheck, {
        message: `Non conosci l'incantesimo: ${primarySpell.name}`,
        turnCounter: combat.turnCounter,
      }),
    };
  }

  if (!hasLearnedSpell(actor, secondarySpell.id)) {
    const blockedCheck = buildBlockedCheck("combat:doubleCastSpell:blocked", turnActorId, ["combat:blocked=spellNotLearned"]);
    return {
      save: applyBlockedCheck(save, blockedCheck, {
        message: `Non conosci l'incantesimo: ${secondarySpell.name}`,
        turnCounter: combat.turnCounter,
      }),
    };
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
      return {
        save: applyBlockedCheck(
          save,
          buildBlockedCheck("combat:doubleCastSpell:blocked", turnActorId, ["combat:blocked=freeSpellUsed"])
        ),
      };
    }
  } else {
    if (!combat.turn.actionAvailable) {
      return {
        save: applyBlockedCheck(
          save,
          buildBlockedCheck("combat:doubleCastSpell:blocked", turnActorId, ["combat:blocked=noAction"])
        ),
      };
    }
  }

  if (actor.conditions?.shock && actionCastTime === "fullRound") {
    return {
      save: applyBlockedCheck(
        save,
        buildBlockedCheck("combat:doubleCastSpell:blocked", turnActorId, ["combat:blocked=shock"])
      ),
    };
  }

  let currentSave = save;
  if (castOptions?.magicConduct) {
    if (catalogs && !hasUnlockedAction(save, catalogs, turnActorId, "magic:conduct")) {
      return {
        save: applyBlockedCheck(
          save,
          buildBlockedCheck("combat:doubleCastSpell:blocked", turnActorId, [
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
          buildBlockedCheck("combat:doubleCastSpell:blocked", turnActorId, [
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

