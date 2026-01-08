import type {
  Check,
  SingleCheck,
  MultiCheck,
  OpposedCheck,
  SequenceCheck,
  MagicChannelCheck,
  MagicEffectCheck,
  CombatAttackCheck,
  ActorRef,
  StatOrSkillKey,
  GameSave,
  Actor,
  CheckResult,
  StoryPack,
  StatKey,
} from "./types";
import { type IRNG } from "./rng";
import { computeCombatModifiersFromConditions } from "./conditions";
import { getEquippedWeaponId } from "./characters/inventory";
import { distanceChebyshev } from "./combat/movement";
import { appendRuntimeLog } from "./combat/narration";

/**
 * Resolves an ActorRef to an Actor
 */
export function resolveActor(actorRef: ActorRef | undefined, save: GameSave, storyPack?: StoryPack): Actor | null {
  if (!actorRef) {
    return save.actorsById[save.party.activeActorId] || null;
  }

  switch (actorRef.mode) {
    case "active":
      return save.actorsById[save.party.activeActorId] || null;

    case "byId":
      return save.actorsById[actorRef.actorId] || null;

    case "bestOfParty": {
      let best: Actor | null = null;
      let bestValue = -Infinity;

      for (const actorId of save.party?.actors ?? []) {
        const actor = save.actorsById[actorId];
        if (!actor) continue;

        const value = getStatOrSkillValue(actor, actorRef.key, save, storyPack);
        if (value > bestValue) {
          bestValue = value;
          best = actor;
        }
      }

      return best;
    }

    case "askPlayer":
      // For now, default to active actor
      // In a real implementation, this would prompt the player
      return save.actorsById[save.party.activeActorId] || null;

    default:
      return null;
  }
}

function getEquippedItems(actor: Actor): string[] {
  const items: string[] = [];
  if (actor.equipment?.mainHand) {
    items.push(actor.equipment.mainHand.id);
  }
  if (actor.equipment?.offHand) {
    items.push(actor.equipment.offHand.id);
  }
  if (actor.equipment?.armor) {
    items.push(actor.equipment.armor.id);
  }
  return items;
}

/**
 * Calculates skill modifier based on rank:
 * - Rank 0 (untrained): -20 penalty
 * - Rank 1: +0 (no bonus/malus)
 * - Rank 2+: +10 per rank above 1 (rank 2 = +10, rank 3 = +20, etc.)
 */
function getSkillModifierFromRank(rank: number): number {
  if (rank === 0) {
    return -20;
  } else if (rank === 1) {
    return 0;
  } else {
    return (rank - 1) * 10;
  }
}

/**
 * Gets the base stat value for a skill from the skill catalog
 */
function getSkillBaseStat(skillId: string, storyPack: StoryPack): StatKey | null {
  const skills = storyPack.skills || [];
  const skill = skills.find((s: any) => s.id === skillId);
  return skill?.baseStat || null;
}

/**
 * Gets the value of a stat or skill for an actor
 * For skills, returns: baseStat + skillModifier(rank) + equipment bonuses + temp modifiers
 */
export function getStatOrSkillValue(actor: Actor, key: StatOrSkillKey, save: GameSave, storyPack?: StoryPack): number {
  // Check if it's a stat
  if (key in actor.stats) {
    let value = actor.stats[key as keyof typeof actor.stats];

    // Apply equipment bonuses
    const items = getEquippedItems(actor);

    for (const itemId of items) {
      const item = save.itemCatalogById[itemId];
      if (!item) continue;

      for (const mod of item.mods) {
        if (mod.type === "bonusStat" && mod.stat === key) {
          value += mod.value;
        }
      }
    }

    // Apply temp modifiers
    for (const tempMod of actor.status.tempModifiers) {
      if ((tempMod.scope === "check" || tempMod.scope === "all") && (!tempMod.key || tempMod.key === key)) {
        value += tempMod.value;
      }
    }

    return value;
  }

  // Check if it's a skill (SKILL:xxx format)
  if (key.startsWith("SKILL:")) {
    const skillId = key.substring(6);
    const rank = actor.skills[skillId] || 0;

    // Get base stat for the skill
    let baseStatValue = 0;
    if (storyPack) {
      const baseStat = getSkillBaseStat(skillId, storyPack);
      if (baseStat && baseStat in actor.stats) {
        baseStatValue = actor.stats[baseStat];
      }
    }

    // Calculate skill modifier from rank
    const skillModifier = getSkillModifierFromRank(rank);

    // Start with base stat + skill modifier
    let value = baseStatValue + skillModifier;

    // Apply equipment bonuses to base stat
    const items = getEquippedItems(actor);
    for (const itemId of items) {
      const item = save.itemCatalogById[itemId];
      if (!item) continue;

      for (const mod of item.mods) {
        if (mod.type === "bonusStat") {
          const baseStat = storyPack ? getSkillBaseStat(skillId, storyPack) : null;
          if (baseStat && mod.stat === baseStat) {
            value += mod.value;
          }
        }
        if (mod.type === "bonusSkill" && mod.skill === skillId) {
          value += mod.value;
        }
      }
    }

    // Apply temp modifiers
    for (const tempMod of actor.status.tempModifiers) {
      if ((tempMod.scope === "check" || tempMod.scope === "all") && (!tempMod.key || tempMod.key === key)) {
        value += tempMod.value;
      }
    }

    return value;
  }

  return 0;
}

/**
 * Resolves a difficulty string to a modifier number
 */
function resolveDifficulty(difficulty: string, storyPack: StoryPack): number {
  const bands = storyPack.systems.checks.difficultyBands;
  return bands[difficulty] ?? 0;
}

/**
 * Computes target breakdown for a check (base value, temp modifiers, difficulty, final target)
 * Returns all values needed for both target calculation and debug tags
 */
function computeTargetBreakdown(
  actor: Actor,
  key: StatOrSkillKey,
  difficulty: string,
  save: GameSave,
  storyPack: StoryPack
): {
  baseValue: number;
  tempModsSum: number;
  difficultyMod: number;
  finalValue: number;
  target: number;
} {
  // Get base value (without temp modifiers for breakdown)
  let baseValue: number;
  if (key in actor.stats) {
    baseValue = actor.stats[key as keyof typeof actor.stats];
    // Apply equipment bonuses to base
    const items = getEquippedItems(actor);

    for (const itemId of items) {
      const item = save.itemCatalogById[itemId];
      if (!item) continue;

      for (const mod of item.mods) {
        if (mod.type === "bonusStat" && mod.stat === key) {
          baseValue += mod.value;
        }
      }
    }
  } else if (key.startsWith("SKILL:")) {
    const skillId = key.substring(6);
    const rank = actor.skills[skillId] || 0;

    // Get base stat for the skill
    const baseStat = getSkillBaseStat(skillId, storyPack);
    if (baseStat && baseStat in actor.stats) {
      baseValue = actor.stats[baseStat];
    } else {
      baseValue = 0;
    }

    // Add skill modifier from rank
    const skillModifier = getSkillModifierFromRank(rank);
    baseValue += skillModifier;

    // Apply equipment bonuses to base stat
    const items = getEquippedItems(actor);
    for (const itemId of items) {
      const item = save.itemCatalogById[itemId];
      if (!item) continue;

      for (const mod of item.mods) {
        if (mod.type === "bonusStat" && baseStat && mod.stat === baseStat) {
          baseValue += mod.value;
        }
        if (mod.type === "bonusSkill" && mod.skill === skillId) {
          baseValue += mod.value;
        }
      }
    }
  } else {
    baseValue = 0;
  }

  const difficultyMod = resolveDifficulty(difficulty, storyPack);

  // Calculate temp modifiers sum for debug tags
  let tempModsSum = 0;
  for (const tempMod of actor.status.tempModifiers) {
    if ((tempMod.scope === "check" || tempMod.scope === "all") && (!tempMod.key || tempMod.key === key)) {
      tempModsSum += tempMod.value;
    }
  }

  // Use getStatOrSkillValue for final value (includes temp modifiers)
  const finalValue = getStatOrSkillValue(actor, key, save, storyPack);
  const target = finalValue + difficultyMod;

  return {
    baseValue,
    tempModsSum,
    difficultyMod,
    finalValue,
    target,
  };
}

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
    case "multi":
      throw new Error(`Check kind 'multi' is not yet implemented in this vertical slice`);
    case "opposed": {
      const result = performOpposedCheck(check, storyPack, save, rng);
      outcome = { result, save };
      break;
    }
    case "sequence": {
      const result = performSequenceCheck(check, storyPack, save, rng);
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

function performSingleCheck(check: SingleCheck, storyPack: StoryPack, save: GameSave, rng: IRNG): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack);
  if (!actor) return null;

  const breakdown = computeTargetBreakdown(actor, check.key, check.difficulty, save, storyPack);

  const result = rollD100Check(check.id, actor.id, breakdown.target, storyPack, rng);

  // Add target breakdown tags for debugging
  if (result) {
    result.tags.push(`calc:base=${breakdown.baseValue}`);
    result.tags.push(`calc:diff=${breakdown.difficultyMod}`);
    result.tags.push(`calc:mods=${breakdown.tempModsSum}`);
    result.tags.push(`calc:target=${breakdown.target}`);
  }

  return result;
}

function performMultiCheck(check: MultiCheck, storyPack: StoryPack, save: GameSave, rng: IRNG): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack);
  if (!actor) return null;

  // Try each option, succeed if any succeeds
  for (const option of check.options) {
    const baseValue = getStatOrSkillValue(actor, option.key, save, storyPack);
    const difficultyMod = resolveDifficulty(option.difficulty, storyPack);
    const target = baseValue + difficultyMod;

    const result = rollD100Check(check.id, actor.id, target, storyPack, rng);
    if (result && result.success) {
      return result;
    }
  }

  // All failed, return last result
  const lastOption = check.options[check.options.length - 1];
  const baseValue = getStatOrSkillValue(actor, lastOption.key, save, storyPack);
  const difficultyMod = resolveDifficulty(lastOption.difficulty, storyPack);
  const target = baseValue + difficultyMod;

  return rollD100Check(check.id, actor.id, target, storyPack, rng);
}

function performOpposedCheck(check: OpposedCheck, storyPack: StoryPack, save: GameSave, rng: IRNG): CheckResult {
  // Resolve actors - default to active actor if not specified
  const attacker = resolveActor(check.attacker.actorRef, save, storyPack);
  const defender = resolveActor(check.defender.actorRef, save, storyPack) || resolveActor(undefined, save, storyPack);
  if (!attacker || !defender) return null;

  const attackerBreakdown = computeTargetBreakdown(
    attacker,
    check.attacker.key,
    check.attacker.difficulty || "NORMAL",
    save,
    storyPack
  );
  const defenderBreakdown = computeTargetBreakdown(
    defender,
    check.defender.key,
    check.defender.difficulty || "NORMAL",
    save,
    storyPack
  );

  const attackerTarget = attackerBreakdown.target;
  const defenderTarget = defenderBreakdown.target;

  // Roll for both sides
  const attackerRoll = rng.rollD100();
  const defenderRoll = rng.rollD100();

  // Evaluate both rolls
  const attackerResult = evaluateRoll(attackerRoll, attackerTarget, storyPack, check.id, attacker.id);
  const defenderResult = evaluateRoll(defenderRoll, defenderTarget, storyPack, check.id, defender.id);

  if (!attackerResult || !defenderResult) {
    return null;
  }

  // Opposed check rules:
  // 1. If attacker fails -> attacker loses (regardless of defender)
  // 2. If attacker succeeds:
  //    - If defender fails -> attacker wins, DoS = attacker DoS
  //    - If defender succeeds -> compare DoS:
  //      - attacker wins if attackerDoS > defenderDoS
  //      - tie (equal DoS) -> defender wins
  //      - if attacker wins, opposed DoS = attackerDoS - defenderDoS

  let attackerWins = false;
  let opposedDoS = 0;

  if (!attackerResult.success) {
    // Attacker fails -> loses regardless of defender
    attackerWins = false;
    opposedDoS = 0;
  } else {
    // Attacker succeeded
    if (!defenderResult.success) {
      // Defender fails -> attacker wins
      attackerWins = true;
      opposedDoS = attackerResult.dos;
    } else {
      // Both succeeded -> compare DoS
      if (attackerResult.dos > defenderResult.dos) {
        attackerWins = true;
        opposedDoS = attackerResult.dos - defenderResult.dos;
      } else {
        // Tie or defender has higher DoS -> defender wins
        attackerWins = false;
        opposedDoS = 0;
      }
    }
  }

  const isTie = attackerResult.success && defenderResult.success && attackerResult.dos === defenderResult.dos;

  // Build tags with defender details and breakdown
  const tags = [...attackerResult.tags];
  tags.push(`opposed:defenderId=${defender.id}`);
  tags.push(`opposed:defRoll=${defenderRoll}`);
  tags.push(`opposed:defTarget=${defenderTarget}`);
  tags.push(`opposed:attDoS=${attackerResult.dos}`);
  tags.push(`opposed:defDoS=${defenderResult.dos}`);
  tags.push(`opposed:attSuccess=${attackerResult.success ? 1 : 0}`);
  tags.push(`opposed:defSuccess=${defenderResult.success ? 1 : 0}`);
  if (isTie) {
    tags.push("opposed:tie=1");
  }

  // Add target breakdown tags for both sides
  tags.push(`att:calc:base=${attackerBreakdown.baseValue}`);
  tags.push(`att:calc:diff=${attackerBreakdown.difficultyMod}`);
  tags.push(`att:calc:mods=${attackerBreakdown.tempModsSum}`);
  tags.push(`att:calc:target=${attackerTarget}`);
  tags.push(`def:calc:base=${defenderBreakdown.baseValue}`);
  tags.push(`def:calc:diff=${defenderBreakdown.difficultyMod}`);
  tags.push(`def:calc:mods=${defenderBreakdown.tempModsSum}`);
  tags.push(`def:calc:target=${defenderTarget}`);

  // Return result representing opposed outcome
  return {
    checkId: check.id,
    actorId: attacker.id,
    roll: attackerRoll,
    target: attackerTarget,
    success: attackerWins,
    dos: opposedDoS,
    dof: 0, // Keep opposed outcome clean
    critical: attackerResult.critical,
    tags,
  };
}

function performSequenceCheck(check: SequenceCheck, storyPack: StoryPack, save: GameSave, rng: IRNG): CheckResult {
  const steps = check.steps;
  let firstActorId: string | undefined;
  let lastResult: CheckResult | null = null;
  let failedAtIndex: number | undefined;

  // Execute steps in order, stop at first failure
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const result = performCheck(step, storyPack, save, rng);

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

function performMagicChannelCheck(
  check: MagicChannelCheck,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack);
  if (!actor) return null;

  // Magic channel behaves like a normal single check
  // Uses key, respects difficulty and tempModifiers
  const breakdown = computeTargetBreakdown(actor, check.key, check.difficulty || "NORMAL", save, storyPack);

  // Apply focus bonuses for channeling
  let channelBonus = 0;
  const items = getEquippedItems(actor);

  for (const itemId of items) {
    const item = save.itemCatalogById[itemId];
    if (!item) continue;

    for (const mod of item.mods) {
      if (mod.type === "focus" && mod.channelBonus) {
        channelBonus += mod.channelBonus;
      }
    }
  }

  const target = breakdown.target + channelBonus;
  const baseResult = rollD100Check(check.id, actor.id, target, storyPack, rng);

  if (!baseResult) return null;

  // Magic channel resolution rules with targetDoS
  let result: CheckResult;

  if (!baseResult.success) {
    // Underlying roll failed
    result = {
      ...baseResult,
      success: false,
      dos: 0,
      dof: check.targetDoS,
      tags: [...baseResult.tags, "magic:channel=1", `magic:channelTarget=${check.targetDoS}`, "magic:fail=1"],
    };
  } else {
    // Underlying roll succeeded
    if (baseResult.dos < check.targetDoS) {
      // Insufficient channel power
      result = {
        ...baseResult,
        success: false,
        dos: 0,
        dof: check.targetDoS - baseResult.dos,
        tags: [
          ...baseResult.tags,
          "magic:channel=1",
          `magic:channelTarget=${check.targetDoS}`,
          "magic:channelInsufficient=1",
        ],
      };
    } else {
      // Channel succeeds
      result = {
        ...baseResult,
        success: true,
        dos: baseResult.dos, // Keep the produced DoS, do NOT subtract targetDoS
        dof: 0,
        tags: [...baseResult.tags, "magic:channel=1", `magic:channelTarget=${check.targetDoS}`, "magic:success=1"],
      };
    }
  }

  // Check for doubles and add phenomena tags
  addPhenomenaTags(result, check.powerMode || "CONTROLLED");

  return result;
}

function performMagicEffectCheck(
  check: MagicEffectCheck,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack);
  if (!actor) return null;

  // Magic effect performs a D100 check using chosenStat
  const breakdown = computeTargetBreakdown(actor, check.key, check.difficulty || "NORMAL", save, storyPack);

  // Apply focus bonuses for casting
  let castBonus = 0;
  const items = getEquippedItems(actor);

  for (const itemId of items) {
    const item = save.itemCatalogById[itemId];
    if (!item) continue;

    for (const mod of item.mods) {
      if (mod.type === "focus" && mod.castBonus) {
        castBonus += mod.castBonus;
      }
    }
  }

  const target = breakdown.target + castBonus;
  const baseResult = rollD100Check(check.id, actor.id, target, storyPack, rng);

  if (!baseResult) return null;

  // Magic effect resolution rules
  let result: CheckResult;

  if (!baseResult.success) {
    // Check failed
    result = {
      ...baseResult,
      success: false,
      dos: 0,
      dof: check.castingNumberDoS,
      tags: [...baseResult.tags, "magic:fail=1"],
    };
  } else {
    // Check succeeded
    if (baseResult.dos < check.castingNumberDoS) {
      // Insufficient DoS
      result = {
        ...baseResult,
        success: false,
        dos: 0,
        dof: check.castingNumberDoS - baseResult.dos,
        tags: [...baseResult.tags, "magic:insufficient=1"],
      };
    } else {
      // Sufficient DoS - effect succeeds
      const extraDoS = baseResult.dos - check.castingNumberDoS;
      result = {
        ...baseResult,
        success: true,
        dos: extraDoS,
        dof: 0,
        tags: [...baseResult.tags, "magic:success=1", `magic:extraDos=${extraDoS}`],
      };
    }
  }

  // Check for doubles and add phenomena tags
  addPhenomenaTags(result, check.powerMode || "CONTROLLED");

  return result;
}

/**
 * Rolls a D100 and evaluates success/failure
 */
function rollD100Check(checkId: string, actorId: string, target: number, storyPack: StoryPack, rng: IRNG): CheckResult {
  const roll = rng.rollD100();
  return evaluateRoll(roll, target, storyPack, checkId, actorId);
}

/**
 * Evaluates a roll result
 */
function evaluateRoll(
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
function addPhenomenaTags(result: CheckResult, powerMode: "CONTROLLED" | "FORCED"): void {
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

/**
 * Centralized function to compute attack target and modifiers
 * Returns: { target: number; tags: string[]; modifier: number }
 */
function computeAttackTarget(
  check: CombatAttackCheck,
  attacker: Actor,
  defender: Actor,
  save: GameSave,
  storyPack: StoryPack
): { target: number; tags: string[]; modifier: number } {
  // Determine attack stat (WS for MELEE, BS for RANGED)
  const attackStatKey: StatOrSkillKey = check.attacker.mode === "MELEE" ? "WS" : "BS";
  const breakdown = computeTargetBreakdown(attacker, attackStatKey, "NORMAL", save, storyPack);

  // Apply combat modifiers to target
  let combatModifier = 0;
  const modifierTags: string[] = [];

  // Outnumbering modifier
  if (check.modifiers?.outnumbering !== undefined) {
    if (check.modifiers.outnumbering >= 3) {
      combatModifier += 20;
      modifierTags.push("combat:mod:outnumbering=+20");
    } else if (check.modifiers.outnumbering >= 2) {
      combatModifier += 10;
      modifierTags.push("combat:mod:outnumbering=+10");
    }
  }

  // Range band modifier (RANGED only)
  // Global rule based on Chebyshev distance:
  // dist >= 9 => EXTREME (-40)
  // dist 6..8 => LONG (-20)
  // dist 4..5 => NORMAL (+0)
  // dist 2..3 => SHORT (+20)
  // dist 0..1 => POINT_BLANK (+30)
  if (check.attacker.mode === "RANGED" && check.modifiers?.rangeBand) {
    switch (check.modifiers.rangeBand) {
      case "POINT_BLANK":
        combatModifier += 30;
        modifierTags.push("combat:mod:rangeBand:POINT_BLANK=+30");
        break;
      case "SHORT":
        combatModifier += 20; // Changed from +10 to +20
        modifierTags.push("combat:mod:rangeBand:SHORT=+20");
        break;
      case "NORMAL":
        modifierTags.push("combat:mod:rangeBand:NORMAL=+0");
        break;
      case "LONG":
        combatModifier -= 20;
        modifierTags.push("combat:mod:rangeBand:LONG=-20");
        break;
      case "EXTREME":
        combatModifier -= 40;
        modifierTags.push("combat:mod:rangeBand:EXTREME=-40");
        break;
    }
  }

  // Cover modifier (RANGED only)
  if (check.attacker.mode === "RANGED" && check.modifiers?.cover) {
    switch (check.modifiers.cover) {
      case "LIGHT":
        combatModifier -= 10;
        modifierTags.push("combat:mod:cover:LIGHT=-10");
        break;
      case "HEAVY":
        combatModifier -= 20;
        modifierTags.push("combat:mod:cover:HEAVY=-20");
        break;
      case "NONE":
        modifierTags.push("combat:mod:cover:NONE=+0");
        break;
    }
  }

  // Called shot modifier: -10 penalty (changed from -20)
  if (check.modifiers?.calledShot) {
    combatModifier -= 10;
    modifierTags.push("combat:mod:calledShot=-10");
  }

  // Aim stance modifier: +20 bonus for ranged attacks when aim stance is active
  const attackerStance = save.runtime.combat?.stancesByActorId?.[attacker.id];
  if (check.attacker.mode === "RANGED" && attackerStance === "aim") {
    combatModifier += 20;
    modifierTags.push("combat:mod:aim=+20");
  }

  // Stance modifiers
  const defenderStance = save.runtime.combat?.stancesByActorId?.[defender.id];

  // Hit bonus from modifiers (e.g. All-Out Attack +20)
  if (check.modifiers?.hitBonus !== undefined) {
    combatModifier += check.modifiers.hitBonus;
    modifierTags.push(`combat:mod:hitBonus=${check.modifiers.hitBonus > 0 ? "+" : ""}${check.modifiers.hitBonus}`);
  }

  // Unarmed penalty: -20 to hit if attacker is unarmed and defender has a weapon
  const attackerWeaponId = check.attacker.weaponId ?? getEquippedWeaponId(attacker);
  const isAttackerUnarmed = !attackerWeaponId || attackerWeaponId === "unarmed";
  const defenderWeaponId = getEquippedWeaponId(defender);
  const isDefenderArmed = defenderWeaponId && defenderWeaponId !== "unarmed";
  if (isAttackerUnarmed && isDefenderArmed) {
    combatModifier -= 20;
    modifierTags.push("combat:mod:unarmed=-20");
  }

  // Defend: -20 to hit against defender
  if (defenderStance === "defend") {
    combatModifier -= 20;
    modifierTags.push("combat:mod:defenderStance:defend=-20");
  }

  // Prone modifiers
  const isDefenderProne = defender.conditions?.prone !== undefined;
  const isAttackerProne = attacker.conditions?.prone !== undefined;
  if (isDefenderProne) {
    if (check.attacker.mode === "RANGED") {
      // Ranged attacks against prone target: -10 to hit
      combatModifier -= 10;
      modifierTags.push("combat:mod:prone:ranged=-10");
    } else if (check.attacker.mode === "MELEE") {
      // Melee attacks against prone target: +20 if attacker is not prone, 0 if both prone
      if (!isAttackerProne) {
        combatModifier += 20;
        modifierTags.push("combat:mod:prone:melee=+20");
      }
    }
  }

  // Apply fatigue penalty from conditions (capped at -30)
  const conditionModifiers = computeCombatModifiersFromConditions(attacker);
  if (conditionModifiers.toHitPenalty !== undefined) {
    combatModifier -= conditionModifiers.toHitPenalty;
    modifierTags.push(`combat:mod:fatigue=-${conditionModifiers.toHitPenalty}`);
  }

  const attackTarget = breakdown.target + combatModifier;

  return {
    target: attackTarget,
    tags: modifierTags,
    modifier: combatModifier,
  };
}

function performCombatAttackCheck(
  check: CombatAttackCheck,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG,
  resolutionId?: string
): { result: CheckResult; save: GameSave } {
  // Resolve actors
  const attacker = resolveActor(check.attacker.actorRef, save, storyPack);
  const defender = resolveActor(check.defender.actorRef, save, storyPack);
  if (!attacker || !defender) return { result: null, save };

  // Compute attack target using centralized function
  const {
    target: attackTarget,
    tags: modifierTags,
    modifier: combatModifier,
  } = computeAttackTarget(check, attacker, defender, save, storyPack);

  // Determine attack stat for tags
  const attackStatKey: StatOrSkillKey = check.attacker.mode === "MELEE" ? "WS" : "BS";

  // Roll attack
  const attackRoll = rng.rollD100();
  const attackResult = evaluateRoll(attackRoll, attackTarget, storyPack, check.id, attacker.id);

  if (!attackResult) return { result: null, save };

  // Build attack tags
  const tags = [...attackResult.tags];

  // Add modifier tags from computeAttackTarget
  tags.push(...modifierTags);

  // Tag for All-Out Attack bonus (if hitBonus is present)
  if (check.modifiers?.hitBonus !== undefined && check.modifiers.hitBonus > 0) {
    tags.push("combat:stance=allOut");
  }

  // Get breakdown for base value calculation
  const breakdown = computeTargetBreakdown(attacker, attackStatKey, "NORMAL", save, storyPack);
  const defenderStance = save.runtime.combat?.stancesByActorId?.[defender.id];
  if (defenderStance === "defend") {
    tags.push("combat:defenderStance=defend");
  }

  // Add distance and weapon range tags for ranged attacks
  if (check.attacker.mode === "RANGED") {
    const combat = save.runtime.combat;
    if (combat?.active) {
      const attackerPos = combat.positions[attacker.id];
      const defenderPos = combat.positions[defender.id];
      if (attackerPos && defenderPos) {
        const dist = distanceChebyshev(attackerPos, defenderPos);
        tags.push(`combat:distance=${dist}`);

        // Add weapon range if available
        const weaponId =
          check.attacker.weaponId ??
          (attacker.equipment?.mainHand?.kind === "weapon" ? attacker.equipment.mainHand.id : null);
        if (weaponId && weaponId !== "unarmed" && save.weaponsById?.[weaponId]?.range) {
          const weaponRange = save.weaponsById[weaponId].range!;
          tags.push(`combat:weaponRange:short=${weaponRange.short}`);
          tags.push(`combat:weaponRange:long=${weaponRange.long}`);
        }
      }
    }
  }

  tags.push(`combat:attackStat=${attackStatKey}`);
  tags.push(`combat:attackTarget=${attackTarget}`);
  tags.push(`combat:attackRoll=${attackRoll}`);
  tags.push(`combat:attackDoS=${attackResult.dos}`);
  tags.push(`combat:attackDoF=${attackResult.dof}`);
  tags.push(`combat:calc:base=${breakdown.baseValue}`);
  tags.push(`combat:calc:mods=${combatModifier}`); // Use combatModifier instead of tempModsSum
  tags.push(`combat:calc:target=${attackTarget}`);
  tags.push(`combat:defenderId=${defender.id}`);

  // If attack failed, return MISS (with correct DoF)
  if (!attackResult.success) {
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: false,
        dos: 0,
        dof: attackResult.dof, // Use the calculated DoF from evaluateRoll
        critical: attackResult.critical,
        tags,
      },
      save,
    };
  }

  // Attack succeeded - determine defense
  // Check if defender can parry (based on parryDisabledUntilTurnCounterByActorId)
  const combat = save.runtime.combat;
  const turnCounter = combat?.turnCounter ?? 0;
  const disabledUntil = combat?.parryDisabledUntilTurnCounterByActorId?.[defender.id] ?? -1;
  const canParry = turnCounter >= disabledUntil && check.defense.allowParry;
  const canDodge = check.defense.allowDodge;

  // Use skill keys for defense
  const parrySkillKey: StatOrSkillKey = "SKILL:skill:parry";
  const dodgeSkillKey: StatOrSkillKey = "SKILL:skill:dodge";

  let defenseType: "parry" | "dodge" | "none" = "none";
  let defenseSkillKey: StatOrSkillKey | null = null;

  if (check.defense.strategy === "preferParry" && canParry) {
    defenseType = "parry";
    defenseSkillKey = parrySkillKey;
  } else if (check.defense.strategy === "preferDodge" && canDodge) {
    defenseType = "dodge";
    defenseSkillKey = dodgeSkillKey;
  } else if (check.defense.strategy === "autoBest") {
    // Calculate both defense targets and choose the best one
    let parryTarget = -Infinity;
    let dodgeTarget = -Infinity;

    if (canParry) {
      const parryBreakdown = computeTargetBreakdown(defender, parrySkillKey, "NORMAL", save, storyPack);
      parryTarget = parryBreakdown.target;
    }

    if (canDodge) {
      const dodgeBreakdown = computeTargetBreakdown(defender, dodgeSkillKey, "NORMAL", save, storyPack);
      dodgeTarget = dodgeBreakdown.target;
    }

    // Choose the defense with the highest target (best chance to succeed)
    if (canParry && canDodge) {
      if (parryTarget >= dodgeTarget) {
        defenseType = "parry";
        defenseSkillKey = parrySkillKey;
      } else {
        defenseType = "dodge";
        defenseSkillKey = dodgeSkillKey;
      }
    } else if (canParry) {
      defenseType = "parry";
      defenseSkillKey = parrySkillKey;
    } else if (canDodge) {
      defenseType = "dodge";
      defenseSkillKey = dodgeSkillKey;
    }
  }

  tags.push(`combat:defense=${defenseType}`);
  if (!canParry && check.defense.allowParry) {
    tags.push("combat:defense:parryBlocked=1");
  }

  // Initialize updatedSave (will be updated if defense check is logged)
  let updatedSave = save;

  // If no defense, HIT
  if (defenseType === "none" || !defenseSkillKey) {
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: true,
        dos: attackResult.dos,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  }

  // Roll defense using the chosen skill
  const defenseBreakdown = computeTargetBreakdown(defender, defenseSkillKey, "NORMAL", save, storyPack);
  const defenseTarget = defenseBreakdown.target;

  const defenseRoll = rng.rollD100();
  const defenseResult = evaluateRoll(defenseRoll, defenseTarget, storyPack, check.id, defender.id);

  // Log defense check if defender belongs to party
  if (defenseResult) {
    const partyIds = new Set(save.party?.actors ?? []);
    const isDefenderPartyMember = partyIds.has(defender.id) || defender.kind === "PC";

    if (isDefenderPartyMember) {
      const defenseCheckResult: CheckResult = {
        checkId: `${check.id}:defense:${defenseType}`,
        actorId: defender.id,
        roll: defenseRoll,
        target: defenseTarget,
        success: defenseResult.success,
        dos: defenseResult.dos,
        dof: defenseResult.dof,
        critical: defenseResult.critical,
        tags: [
          `combat:defenseType=${defenseType}`,
          `combat:defenseSkill=${defenseSkillKey}`,
          `combat:defTarget=${defenseTarget}`,
          `combat:defRoll=${defenseRoll}`,
          `combat:defDoS=${defenseResult.dos}`,
          `combat:defDoF=${defenseResult.dof}`,
          `combat:defCalc:base=${defenseBreakdown.baseValue}`,
          `combat:defCalc:mods=${defenseBreakdown.tempModsSum}`,
          `combat:defCalc:target=${defenseTarget}`,
        ],
      };
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "check",
        check: defenseCheckResult,
        resolutionId,
      });
    }
  }

  if (!defenseResult) {
    // Defense roll failed somehow, treat as no defense
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: true,
        dos: attackResult.dos,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  }

  // Add defense tags
  tags.push(`combat:defTarget=${defenseTarget}`);
  tags.push(`combat:defRoll=${defenseRoll}`);
  tags.push(`combat:defDoS=${defenseResult.dos}`);
  tags.push(`combat:defSuccess=${defenseResult.success ? 1 : 0}`);
  tags.push(`combat:defCalc:base=${defenseBreakdown.baseValue}`);
  tags.push(`combat:defCalc:mods=${defenseBreakdown.tempModsSum}`);
  tags.push(`combat:defCalc:target=${defenseTarget}`);

  // Determine outcome
  if (!defenseResult.success) {
    // Defense failed - HIT
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: true,
        dos: attackResult.dos,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  }

  // Both attack and defense succeeded - compare DoS
  if (attackResult.dos > defenseResult.dos) {
    // Attacker wins - HIT
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: true,
        dos: attackResult.dos - defenseResult.dos,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  } else {
    // Tie or defender wins - MISS
    const isTie = attackResult.dos === defenseResult.dos;
    if (isTie) {
      tags.push("combat:tie=1");
    }
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: false,
        dos: 0,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  }
}
