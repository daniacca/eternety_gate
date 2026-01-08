import type { SequenceCheck, CheckResult, StoryPack, GameSave, Check } from "../types";
import { type IRNG } from "../rng";

// Type for check handler function - will be provided by index.ts
type CheckHandler = (check: Check, storyPack: StoryPack, save: GameSave, rng: IRNG) => CheckResult;

export function performSequenceCheck(
  check: SequenceCheck,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG,
  performCheckHandler: CheckHandler
): CheckResult {
  const steps = check.steps;
  let firstActorId: string | undefined;
  let lastResult: CheckResult | null = null;
  let failedAtIndex: number | undefined;

  // Execute steps in order, stop at first failure
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const result = performCheckHandler(step, storyPack, save, rng);

    // Skip null results (should be rare)
    if (!result) {
      continue;
    }

    // Track first actor ID
    if (firstActorId === undefined) {
      firstActorId = result.actorId;
    }

    // Track last result for aggregated fields
    lastResult = result;

    // Stop at first failure
    if (!result.success) {
      failedAtIndex = i;
      break;
    }
  }

  // If no steps executed or all were null, return null
  if (!lastResult) {
    return null;
  }

  // Build aggregated result
  const tags = [...lastResult.tags];
  tags.push(`sequence:steps=${steps.length}`);
  if (failedAtIndex !== undefined) {
    tags.push(`sequence:failedAt=${failedAtIndex}`);
  }

  return {
    checkId: check.id,
    actorId: firstActorId || save.party.activeActorId,
    roll: lastResult.roll,
    target: lastResult.target,
    success: failedAtIndex === undefined,
    dos: lastResult.dos,
    dof: lastResult.dof,
    critical: lastResult.critical,
    tags,
  };
}

