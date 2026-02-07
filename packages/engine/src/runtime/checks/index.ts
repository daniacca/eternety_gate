import type { Check, CheckResult, StoryPack, GameSave } from "../types";
import { type IRNG } from "../rng";
import { performSingleCheck } from "./single";
import { performMultiCheck } from "./multi";
import { performConditionCheck } from "./condition";
import { performOpposedCheck } from "./opposed";
import { performSequenceCheck } from "./sequence";
import { performMagicChannelCheck, performMagicEffectCheck } from "./magic";
import { performCombatAttackCheck } from "./combat";
import { appendRuntimeLog } from "../combat/narration";
import { createFateRerollContext, type FateRerollContext } from "./fate";
import { consumeFateProtection } from "../characters/fate";

/**
 * Outcome of a check execution, including the result and updated save state
 */
export type CheckOutcome = { result: CheckResult; save: GameSave };

function performCheckResult(
  check: Check,
  storyPack: StoryPack | undefined,
  save: GameSave,
  rng: IRNG,
  fateContext?: FateRerollContext,
  resolutionId?: string
): CheckResult {
  switch (check.kind) {
    case "single":
      return performSingleCheck(check, storyPack, save, rng, fateContext);
    case "multi":
      return performMultiCheck(check, storyPack, save, rng, fateContext);
    case "condition":
      return performConditionCheck(check, storyPack, save);
    case "opposed":
      return performOpposedCheck(check, storyPack, save, rng, fateContext);
    case "sequence":
      return performSequenceCheck(check, storyPack, save, rng, performCheckResult, fateContext);
    case "magicChannel":
      return performMagicChannelCheck(check, storyPack, save, rng, fateContext);
    case "magicEffect":
      return performMagicEffectCheck(check, storyPack, save, rng, fateContext);
    case "combatAttack":
      return performCombatAttackCheck(check, storyPack, save, rng, resolutionId, fateContext).result;
    default:
      throw new Error(`Unknown check kind: ${(check as any).kind}`);
  }
}

/**
 * Performs a D100 check and returns both the result and updated save.
 * Automatically logs checks performed by party members to runtimeLog.
 * This is the core function that handles all check execution and logging.
 */
export function performCheckWithSave(
  check: Check,
  storyPack: StoryPack | undefined,
  save: GameSave,
  rng: IRNG,
  resolutionId?: string
): CheckOutcome {
  const fateContext = createFateRerollContext();
  let outcome: CheckOutcome;

  if (check.kind === "combatAttack") {
    // performCombatAttackCheck logs defense checks internally (if defender is party member)
    // The attack check itself will be logged by centralized logging below
    outcome = performCombatAttackCheck(check, storyPack, save, rng, resolutionId, fateContext);
  } else {
    const result = performCheckResult(check, storyPack, save, rng, fateContext, resolutionId);
    outcome = { result, save };
  }

  if (fateContext.used && fateContext.actorId) {
    outcome = {
      ...outcome,
      save: consumeFateProtection(outcome.save, fateContext.actorId).save,
    };
  }

  if (outcome.result?.tags?.includes("fate:mastery=1")) {
    const actorId = outcome.result.actorId;
    const actor = outcome.save.actorsById[actorId];
    const fatePoints = actor?.resources.fatePoints ?? 0;
    if (actor && fatePoints > 0) {
      const updatedActor = {
        ...actor,
        resources: {
          ...actor.resources,
          fatePoints: fatePoints - 1,
        },
      };
      outcome = {
        ...outcome,
        save: {
          ...outcome.save,
          actorsById: {
            ...outcome.save.actorsById,
            [actorId]: updatedActor,
          },
        },
      };
    }
  }

  // Centralized logging: log check if party member performed it
  // This applies to ALL check kinds (attack, parry/dodge, knockdown, disarm, narrative, magic, etc.)
  // Defense checks are already logged inside performCombatAttackCheck when defender is party member
  const updatedSave = logCheckIfPartyMember(outcome.save, outcome.result, resolutionId);

  return {
    result: outcome.result,
    save: updatedSave,
  };
}

/**
 * Performs a D100 check and returns only the result.
 * This is a thin wrapper around performCheckWithSave for backward compatibility.
 * For new code that needs the updated save, use performCheckWithSave instead.
 */
export function performCheck(check: Check, storyPack: StoryPack | undefined, save: GameSave, rng: IRNG): CheckResult {
  return performCheckWithSave(check, storyPack, save, rng).result;
}

/**
 * Helper to log a check if the actor belongs to the party.
 * Returns updated save with log entry if logged, or original save if not.
 */
export function logCheckIfPartyMember(save: GameSave, result: CheckResult | null, resolutionId?: string): GameSave {
  if (!result) return save;

  const actorId = result.actorId;
  const partyIds = new Set(save.party?.actors ?? []);
  const actor = save.actorsById[actorId];
  const isPartyMember = partyIds.has(actorId) || actor?.kind === "PC";

  if (isPartyMember) {
    return appendRuntimeLog(save, {
      kind: "check",
      check: result,
      resolutionId,
    });
  }

  return save;
}

// Re-export public utilities
export { resolveActor } from "./resolve";
export { getStatOrSkillValue } from "./values";
export { computeTargetBreakdown, resolveDifficulty } from "./target";
export { getSkillModifierFromRank, getSkillBaseStat } from "./skills";
export { evaluateRoll, rollD100Check, addPhenomenaTags } from "./evaluation";
export { computeAttackTarget } from "./combat";
export { performCombatAttackCheck } from "./combat";