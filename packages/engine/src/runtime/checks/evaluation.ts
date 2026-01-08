import type { CheckResult, StoryPack } from "../types";

/**
 * Rolls a D100 and evaluates success/failure
 */
export function rollD100Check(
  checkId: string,
  actorId: string,
  target: number,
  storyPack: StoryPack,
  rng: { rollD100: () => number }
): CheckResult {
  const roll = rng.rollD100();
  return evaluateRoll(roll, target, storyPack, checkId, actorId);
}

/**
 * Evaluates a roll result
 */
export function evaluateRoll(
  roll: number,
  target: number,
  storyPack: StoryPack,
  checkId?: string,
  actorId?: string
): CheckResult {
  const criticals = storyPack.systems.checks.criticals;
  const autoSuccess = criticals.autoSuccess || [1, 2, 3];
  const autoFail = criticals.autoFail || [98, 99, 100];
  const epic = criticals.epic;

  let critical: NonNullable<CheckResult>["critical"] = "none";
  let success = false;
  let dos = 0;
  let dof = 0;
  const tags: string[] = [];

  // Check for auto-success
  if (autoSuccess.includes(roll)) {
    critical = "autoSuccess";
    success = true;
    dos = Math.max(1, Math.floor((target - roll) / 10));

    // Check for epic success
    if (epic && roll === epic.success) {
      critical = "epicSuccess";
      dos = epic.treatAsDoS;
      tags.push("epicSuccess");
    }
  }
  // Check for auto-fail
  else if (autoFail.includes(roll)) {
    critical = "autoFail";
    success = false;
    dof = Math.max(1, Math.floor((roll - target) / 10));

    // Check for epic fail
    if (epic && roll === epic.fail) {
      critical = "epicFail";
      dof = Math.max(1, Math.floor((roll - target) / 10));
      tags.push("epicFail");
    }
  }
  // Normal roll
  else {
    success = roll <= target;
    if (success) {
      dos = Math.floor((target - roll) / 10);
    } else {
      dof = Math.floor((roll - target) / 10);
    }
  }

  // Check for doubles (phenomena)
  const tens = Math.floor(roll / 10);
  const ones = roll % 10;
  if (tens === ones && roll >= 11) {
    tags.push("doubles");
  }

  return {
    checkId: checkId || "",
    actorId: actorId || "",
    roll,
    target,
    success,
    dos,
    dof,
    critical,
    tags,
  };
}

/**
 * Adds phenomena tags for magic checks when doubles are detected
 */
export function addPhenomenaTags(result: CheckResult, powerMode: "CONTROLLED" | "FORCED"): void {
  if (!result) return;

  // Check if doubles tag exists (added by evaluateRoll)
  if (result.tags.includes("doubles")) {
    result.tags.push("phenomena:doubles");
    if (powerMode === "CONTROLLED") {
      result.tags.push("phenomena:minor");
    } else if (powerMode === "FORCED") {
      result.tags.push("phenomena:major");
    }
  }
}

