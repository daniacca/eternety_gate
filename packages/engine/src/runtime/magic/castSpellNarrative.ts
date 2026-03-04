import type { GameSave, ActorId, SingleCheck, RuntimeLogEntry } from "../types";
import type { IRNG } from "../rng";
import type { CharacterCatalogs } from "../../content/catalogs";
import type {
  NarrativeSpellRequest,
  NarrativeSpellResult,
  NarrativeOp,
  NarrativePhenomenaResult,
  SpellDefinitionExtended,
  EffectDefinitionExtended,
} from "./types";
import { getSpellById, getEffectById } from "./catalogs";
import { hasLearnedSpell } from "./learning";
import { getMagicPower } from "./pm";
import { getMcMax, getMcCurrent, setMcCurrent, ensureMcReserve } from "./od";
import { getMcSpentForMode, getCastModifierForMode, getOvercastLevel } from "./castModes";
import { getPhenomenaTrigger, getPhenomenaSeverityFromDof, getPhenomenaSeverity, rollPhenomena } from "./phenomena";
import { performCheckWithSave } from "../checks";
import { applyFatigue } from "../characters/fatigue";
import { applyNarrativeOps } from "./applyNarrativeOps";

// Re-export applyNarrativeOps for backwards compatibility
export { applyNarrativeOps } from "./applyNarrativeOps";

/**
 * Appends a runtime log entry for narrative magic
 */
function appendNarrativeLog(
  save: GameSave,
  entry: RuntimeLogEntry
): GameSave {
  const runtimeLog = save.runtime.runtimeLog ?? [];
  return {
    ...save,
    runtime: {
      ...save.runtime,
      runtimeLog: [...runtimeLog, entry],
    },
  };
}

/**
 * Runs a narrative spell cast
 *
 * This performs spell casting outside of combat:
 * - Uses same spell/effect catalogs as combat
 * - Performs ONE casting check (d100)
 * - Applies RF costs
 * - Triggers phenomena on doubles
 * - Applies narrative ops based on success/failure
 * 
 * Merge precedence: effect.narrativeDefaults ops run FIRST, then spell.narrative ops
 */
export function runNarrativeSpell(
  save: GameSave,
  request: NarrativeSpellRequest,
  rng: IRNG,
  catalogs?: CharacterCatalogs
): { save: GameSave; result: NarrativeSpellResult } {
  const tags: string[] = ["magic:mode=narrative"];
  const logs: string[] = [];
  const appliedOps: NarrativeOp[] = [];
  const skipRfCost = request.options?.skipRfCost;

  // Resolve caster
  const casterId = (request.casterId ?? save.party.activeActorId) as ActorId;
  const caster = save.actorsById[casterId];
  if (!caster) {
    return {
      save,
      result: {
        ok: false,
        success: false,
        appliedOps: [],
        logs: ["Incantatore non trovato"],
        tags: [...tags, "error:casterNotFound"],
      },
    };
  }
  if (caster.conditions?.frenzy) {
    return {
      save,
      result: {
        ok: false,
        success: false,
        appliedOps: [],
        logs: ["Non puoi lanciare incantesimi mentre sei in Frenzy."],
        tags: [...tags, "magic:blocked=frenzy"],
      },
    };
  }
  if (caster.conditions?.beast_form) {
    return {
      save,
      result: {
        ok: false,
        success: false,
        appliedOps: [],
        logs: ["Non puoi lanciare incantesimi mentre sei in Beast Form."],
        tags: [...tags, "magic:blocked=beastForm"],
      },
    };
  }
  tags.push(`magic:caster=${casterId}`);

  // Load spell definition
  const spell = getSpellById(request.spellId) as SpellDefinitionExtended | undefined;
  if (!spell) {
    return {
      save,
      result: {
        ok: false,
        success: false,
        appliedOps: [],
        logs: ["Incantesimo non trovato"],
        tags: [...tags, "error:spellNotFound"],
      },
    };
  }
  tags.push(`magic:spell=${spell.id}`);

  // Check narrative usage
  const usage = spell.usage ?? { combat: true, narrative: false };
  if (!usage.narrative) {
    return {
      save,
      result: {
        ok: false,
        success: false,
        appliedOps: [],
        logs: ["Non puoi usare questo incantesimo fuori dal combattimento."],
        tags: [...tags, "error:narrativeNotAllowed"],
      },
    };
  }

  // Check if spell is learned
  if (!hasLearnedSpell(caster, spell.id)) {
    return {
      save,
      result: {
        ok: false,
        success: false,
        appliedOps: [],
        logs: ["Non conosci questo incantesimo."],
        tags: [...tags, "error:spellNotLearned"],
      },
    };
  }

  // Load effect definition
  const effect = getEffectById(spell.effectId) as EffectDefinitionExtended | undefined;
  if (!effect) {
    return {
      save,
      result: {
        ok: false,
        success: false,
        appliedOps: [],
        logs: ["Effetto incantesimo non trovato"],
        tags: [...tags, "error:effectNotFound"],
      },
    };
  }

  const narrativeConfig = spell.narrative ?? {
    target: "self",
    requiresCheck: true,
  };

  const cnBase = spell.baseCN;
  const fromScroll = request.options?.fromScroll === true;
  tags.push(`magic:cn=${cnBase}`);

  if (catalogs && !fromScroll) {
    save = ensureMcReserve(save, casterId, catalogs);
  }
  const casterWithMc = save.actorsById[casterId]!;
  const pm = getMagicPower(save, casterId, catalogs);
  const mode = request.options?.castMode ?? "FETTERED";
  const mcSpent = getMcSpentForMode(mode, cnBase, pm);
  const mcMax = getMcMax(save, casterId, catalogs);
  const currentMc = getMcCurrent(casterWithMc, mcMax);
  if (!fromScroll && currentMc < mcSpent) {
    return {
      save,
      result: {
        ok: true,
        success: false,
        appliedOps: [],
        logs: [`MC insufficienti (servono ${mcSpent}, disponibili ${currentMc}).`],
        tags: [...tags, "magic:blocked=insufficientMC"],
      },
    };
  }
  tags.push(`magic:pm=${pm}`);

  const castModifier = getCastModifierForMode(pm, fromScroll ? cnBase : mcSpent);
  const castingCheck: SingleCheck = {
    id: `narrative:cast:${spell.id}:${casterId}`,
    kind: "single",
    actorRef: { mode: "byId", actorId: casterId },
    key: effect.castingStat,
    difficulty: "Challenging",
    modifier: castModifier !== 0 ? castModifier : undefined,
  };

  logs.push("Canalizzi la Trama...");

  const { result: checkResult, save: afterCheckSave } = performCheckWithSave(
    castingCheck,
    undefined, // No storyPack for narrative
    save,
    rng
  );

  let updatedSave = afterCheckSave;

  // Handle null result
  if (!checkResult) {
    return {
      save: updatedSave,
      result: {
        ok: false,
        success: false,
        appliedOps: [],
        logs: ["Errore nel controllo di lancio"],
        tags: [...tags, "error:checkFailed"],
      },
    };
  }

  const minDoS = narrativeConfig.minDoSToSucceed ?? 0;
  const castDoS = checkResult.dos;
  const effectiveDoS = castDoS;
  const success = checkResult.success && effectiveDoS >= minDoS;
  const effectiveMcSpent = fromScroll ? 0 : mcSpent;
  const overcast = fromScroll ? 0 : getOvercastLevel(effectiveMcSpent, cnBase);

  // Consume MC (skip when fromScroll)
  if (!fromScroll) {
    const casterAfterCheck = updatedSave.actorsById[casterId];
    const mcAfterCheck = casterAfterCheck ? getMcCurrent(casterAfterCheck, mcMax) : currentMc;
    updatedSave = setMcCurrent(updatedSave, casterId, mcAfterCheck - mcSpent, mcMax);
  }

  tags.push(`magic:roll=${checkResult.roll}`);
  tags.push(`magic:target=${checkResult.target}`);
  tags.push(`magic:dos=${effectiveDoS}`);
  tags.push(`magic:success=${success}`);

  const phenomenaTriggered = getPhenomenaTrigger(mode, checkResult);
  const phenomenaSeverityTier =
    phenomenaTriggered && checkResult.dof >= 2
      ? getPhenomenaSeverityFromDof(checkResult.dof, mode)
      : phenomenaTriggered
        ? getPhenomenaSeverity(cnBase, pm, effectiveDoS) === "severe"
          ? ("moderate" as const)
          : ("minor" as const)
        : null;
  const severityForResult: "none" | "minor" | "major" =
    !phenomenaTriggered ? "none" : phenomenaSeverityTier === "major" ? "major" : "minor";

  let phenomenaResult: NarrativePhenomenaResult = {
    triggered: phenomenaTriggered,
    severity: severityForResult,
  };

  // Calculate RF cost
  let rfToApply = 0;

  if (success) {
    // Success RF rules
    if (cnBase > pm) {
      rfToApply += 1;
    }
    if (phenomenaTriggered) {
      rfToApply += 1;
    }
    if (effect.specialFatigue) {
      rfToApply += effect.specialFatigue;
    }
    if (effect.rfOnSuccess) {
      rfToApply += effect.rfOnSuccess;
    }
  } else {
    // Failure RF rules
    if (cnBase > pm) {
      rfToApply += 1;
    }
    if (checkResult.dof >= 2) {
      rfToApply += 2;
    }
    if (phenomenaTriggered) {
      rfToApply += 1;
    }
  }

  // Apply RF
  if (skipRfCost) {
    rfToApply = 0;
  }
  if (rfToApply > 0) {
    updatedSave = applyFatigue(updatedSave, casterId, rfToApply, catalogs);
    logs.push(`Affaticamento: +${rfToApply} RF`);
  }

  if (phenomenaTriggered) {
    const severityForRoll =
      phenomenaSeverityTier && phenomenaSeverityTier !== "mild" ? phenomenaSeverityTier : undefined;
    const phenomenaRollResult = rollPhenomena(updatedSave, casterId, rng, catalogs, severityForRoll);
    updatedSave = phenomenaRollResult.save;
    phenomenaResult.effectDescription = phenomenaRollResult.description;
    tags.push(`magic:phenomena=${phenomenaRollResult.kind}`);
    logs.push(`La Trama sfugge al controllo: ${phenomenaRollResult.description}`);
  }

  // Build final ops with correct merge precedence:
  // effect.narrativeDefaults ops run FIRST, then spell.narrative ops
  let opsToApply: NarrativeOp[] = [];

  if (success) {
    // Merge: effect defaults first, then spell overrides
    const effectOps = effect.narrativeDefaults?.onSuccess ?? [];
    const spellOps = narrativeConfig.onSuccess ?? [];
    opsToApply = [...effectOps, ...spellOps];
    logs.push(`${spell.name}: SUCCESSO (DoS: ${effectiveDoS})`);
  } else {
    // Merge: effect defaults first, then spell overrides
    const effectOps = effect.narrativeDefaults?.onFailure ?? [];
    const spellOps = narrativeConfig.onFailure ?? [];
    opsToApply = [...effectOps, ...spellOps];
    logs.push(
      `${spell.name}: FALLIMENTO (DoF: ${checkResult.dof})`
    );
  }

  if (spell.discipline === "MENTIS") {
    const targetActorId =
      narrativeConfig.target === "self"
        ? casterId
        : narrativeConfig.target === "singleActor"
        ? (request.targetActorId as ActorId | undefined)
        : undefined;
    if (targetActorId) {
      const targetActor = updatedSave.actorsById[targetActorId];
      if (targetActor?.traits?.["trait:from_beyond"] !== undefined) {
        opsToApply = [];
        logs.push("L'obiettivo è immune agli effetti mentali.");
        tags.push("magic:immune=from_beyond");
      }
    }
  }

  // Apply narrative ops
  if (opsToApply.length > 0) {
    const { save: afterOpsSave, emittedLogs } = applyNarrativeOps(
      updatedSave,
      opsToApply,
      { dos: effectiveDoS, catalogs }
    );
    updatedSave = afterOpsSave;
    logs.push(...emittedLogs);
    appliedOps.push(...opsToApply);
  }

  // Persist RNG counter
  if (typeof (rng as any).getCounter === "function") {
    updatedSave = {
      ...updatedSave,
      runtime: {
        ...updatedSave.runtime,
        rngCounter: (rng as any).getCounter(),
      },
    };
  }

  // Append runtime log
  updatedSave = appendNarrativeLog(updatedSave, {
    kind: "system",
    message: `Incantesimo narrativo: ${spell.name} - ${success ? "SUCCESSO" : "FALLIMENTO"}`,
    tags: [...tags],
  });

  // Update lastCheck
  updatedSave = {
    ...updatedSave,
    runtime: {
      ...updatedSave.runtime,
      lastCheck: checkResult,
    },
  };

  return {
    save: updatedSave,
    result: {
      ok: true,
      success,
      check: checkResult,
      phenomena: phenomenaResult,
      appliedOps,
      logs,
      tags,
    },
  };
}
