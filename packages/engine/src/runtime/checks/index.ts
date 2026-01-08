import type {
  Check,
  SingleCheck,
  MultiCheck,
  OpposedCheck,
  SequenceCheck,
  MagicChannelCheck,
  MagicEffectCheck,
  CombatAttackCheck,
  CheckResult,
  StoryPack,
  GameSave,
  CheckOutcome,
} from "../types";
import { type IRNG } from "../rng";
import { resolveActor } from "./resolve";
import { getStatOrSkillValue } from "./values";
import { performSingleCheck } from "./single";
import { performMultiCheck } from "./multi";
import { performOpposedCheck } from "./opposed";
import { performSequenceCheck } from "./sequence";
import { performMagicChannelCheck, performMagicEffectCheck } from "./magic";
import { performCombatAttackCheck } from "./combat";
import { appendRuntimeLog } from "../combat/narration";

/**
 * Check handler function type
 */
type CheckHandler = (check: Check, storyPack: StoryPack, save: GameSave, rng: IRNG) => CheckResult;

/**
 * Registry of check handlers by check kind
 */
const checkHandlers: Record<Check["kind"], CheckHandler> = {
  single: (check, storyPack, save, rng) =>
    performSingleCheck(check as SingleCheck, storyPack, save, rng),
  multi: (check, storyPack, save, rng) =>
    performMultiCheck(check as MultiCheck, storyPack, save, rng),
  opposed: (check, storyPack, save, rng) =>
    performOpposedCheck(check as OpposedCheck, storyPack, save, rng),
  sequence: (check, storyPack, save, rng) =>
    performSequenceCheck(check as SequenceCheck, storyPack, save, rng, performCheck),
  magicChannel: (check, storyPack, save, rng) =>
    performMagicChannelCheck(check as MagicChannelCheck, storyPack, save, rng),
  magicEffect: (check, storyPack, save, rng) =>
    performMagicEffectCheck(check as MagicEffectCheck, storyPack, save, rng),
  combatAttack: (check, storyPack, save, rng) =>
    performCombatAttackCheck(check as CombatAttackCheck, storyPack, save, rng).result,
};

/**
 * Outcome of a check execution, including the result and updated save state
 */
export type CheckOutcome = { result: CheckResult; save: GameSave };

/**
 * Performs a D100 check and returns both the result and updated save.
 * Automatically logs checks performed by party members to runtimeLog.
 * This is the core function that handles all check execution and logging.
 */
export function performCheckWithSave(
  check: Check,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG,
  resolutionId?: string
): CheckOutcome {
  let outcome: CheckOutcome;

  switch (check.kind) {
    case "single": {
      const result = performSingleCheck(check, storyPack, save, rng);
      outcome = { result, save };
      break;
    }
    case "multi": {
      const result = performMultiCheck(check, storyPack, save, rng);
      outcome = { result, save };
      break;
    }
    case "opposed": {
      const result = performOpposedCheck(check, storyPack, save, rng);
      outcome = { result, save };
      break;
    }
    case "sequence": {
      const result = performSequenceCheck(check, storyPack, save, rng, performCheck);
      outcome = { result, save };
      break;
    }
    case "magicChannel": {
      const result = performMagicChannelCheck(check, storyPack, save, rng);
      outcome = { result, save };
      break;
    }
    case "magicEffect": {
      const result = performMagicEffectCheck(check, storyPack, save, rng);
      outcome = { result, save };
      break;
    }
    case "combatAttack":
      // performCombatAttackCheck logs defense checks internally (if defender is party member)
      // The attack check itself will be logged by centralized logging below
      outcome = performCombatAttackCheck(check, storyPack, save, rng, resolutionId);
      break;
    default:
      throw new Error(`Unknown check kind: ${(check as any).kind}`);
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
export function performCheck(check: Check, storyPack: StoryPack, save: GameSave, rng: IRNG): CheckResult {
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

