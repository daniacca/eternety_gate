import type {
  Check,
  SingleCheck,
  MultiCheck,
  OpposedCheck,
  SequenceCheck,
  MagicChannelCheck,
  MagicEffectCheck,
  ActorRef,
  StatOrSkillKey,
  GameSave,
  Actor,
  CheckResult,
  StoryPack,
} from "./types";
import { RNG } from "./rng";

/**
 * Resolves an ActorRef to an Actor
 */
export function resolveActor(actorRef: ActorRef | undefined, save: GameSave): Actor | null {
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

      for (const actorId of save.party.actors) {
        const actor = save.actorsById[actorId];
        if (!actor) continue;

        const value = getStatOrSkillValue(actor, actorRef.key, save);
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

/**
 * Gets the value of a stat or skill for an actor
 */
export function getStatOrSkillValue(actor: Actor, key: StatOrSkillKey, save: GameSave): number {
  // Check if it's a stat
  if (key in actor.stats) {
    let value = actor.stats[key as keyof typeof actor.stats];

    // Apply equipment bonuses
    const equipped = actor.equipment.equipped;
    const items = [equipped.weaponMainId, equipped.weaponOffId, equipped.armorId, ...equipped.accessoryIds].filter(
      (id): id is string => id !== null
    );

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
    let value = actor.skills[skillId] || 0;

    // Apply equipment bonuses
    const equipped = actor.equipment.equipped;
    const items = [equipped.weaponMainId, equipped.weaponOffId, equipped.armorId, ...equipped.accessoryIds].filter(
      (id): id is string => id !== null
    );

    for (const itemId of items) {
      const item = save.itemCatalogById[itemId];
      if (!item) continue;

      for (const mod of item.mods) {
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
    const equipped = actor.equipment.equipped;
    const items = [equipped.weaponMainId, equipped.weaponOffId, equipped.armorId, ...equipped.accessoryIds].filter(
      (id): id is string => id !== null
    );
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
    baseValue = actor.skills[skillId] || 0;
    // Apply equipment bonuses to base
    const equipped = actor.equipment.equipped;
    const items = [equipped.weaponMainId, equipped.weaponOffId, equipped.armorId, ...equipped.accessoryIds].filter(
      (id): id is string => id !== null
    );
    for (const itemId of items) {
      const item = save.itemCatalogById[itemId];
      if (!item) continue;
      for (const mod of item.mods) {
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
  const finalValue = getStatOrSkillValue(actor, key, save);
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
 * Performs a D100 check
 */
export function performCheck(check: Check, storyPack: StoryPack, save: GameSave, rng: RNG): CheckResult {
  switch (check.kind) {
    case "single":
      return performSingleCheck(check, storyPack, save, rng);
    case "multi":
      throw new Error(`Check kind 'multi' is not yet implemented in this vertical slice`);
    case "opposed":
      return performOpposedCheck(check, storyPack, save, rng);
    case "sequence":
      return performSequenceCheck(check, storyPack, save, rng);
    case "magicChannel":
      throw new Error(`Check kind 'magicChannel' is not yet implemented in this vertical slice`);
    case "magicEffect":
      throw new Error(`Check kind 'magicEffect' is not yet implemented in this vertical slice`);
    default:
      throw new Error(`Unknown check kind: ${(check as any).kind}`);
  }
}

function performSingleCheck(check: SingleCheck, storyPack: StoryPack, save: GameSave, rng: RNG): CheckResult {
  const actor = resolveActor(check.actorRef, save);
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

function performMultiCheck(check: MultiCheck, storyPack: StoryPack, save: GameSave, rng: RNG): CheckResult {
  const actor = resolveActor(check.actorRef, save);
  if (!actor) return null;

  // Try each option, succeed if any succeeds
  for (const option of check.options) {
    const baseValue = getStatOrSkillValue(actor, option.key, save);
    const difficultyMod = resolveDifficulty(option.difficulty, storyPack);
    const target = baseValue + difficultyMod;

    const result = rollD100Check(check.id, actor.id, target, storyPack, rng);
    if (result && result.success) {
      return result;
    }
  }

  // All failed, return last result
  const lastOption = check.options[check.options.length - 1];
  const baseValue = getStatOrSkillValue(actor, lastOption.key, save);
  const difficultyMod = resolveDifficulty(lastOption.difficulty, storyPack);
  const target = baseValue + difficultyMod;

  return rollD100Check(check.id, actor.id, target, storyPack, rng);
}

function performOpposedCheck(check: OpposedCheck, storyPack: StoryPack, save: GameSave, rng: RNG): CheckResult {
  // Resolve actors - default to active actor if not specified
  const attacker = resolveActor(check.attacker.actorRef, save);
  const defender = resolveActor(check.defender.actorRef, save) || resolveActor(undefined, save);
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

function performSequenceCheck(check: SequenceCheck, storyPack: StoryPack, save: GameSave, rng: RNG): CheckResult {
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
  rng: RNG
): CheckResult {
  const actor = resolveActor(check.actorRef, save);
  if (!actor) return null;

  const baseValue = getStatOrSkillValue(actor, check.key, save);

  // Apply focus bonuses for channeling
  let channelBonus = 0;
  const equipped = actor.equipment.equipped;
  const items = [equipped.weaponMainId, equipped.weaponOffId, equipped.armorId, ...equipped.accessoryIds].filter(
    (id): id is string => id !== null
  );

  for (const itemId of items) {
    const item = save.itemCatalogById[itemId];
    if (!item) continue;
    for (const mod of item.mods) {
      if (mod.type === "focus" && mod.channelBonus) {
        channelBonus += mod.channelBonus;
      }
    }
  }

  const target = baseValue + channelBonus;
  const result = rollD100Check(check.id, actor.id, target, storyPack, rng);

  // Note: Magic DoS accumulation is handled in engine.ts after the check
  return result;
}

function performMagicEffectCheck(check: MagicEffectCheck, storyPack: StoryPack, save: GameSave, rng: RNG): CheckResult {
  const actor = resolveActor(check.actorRef, save);
  if (!actor) return null;

  // Check if we have enough accumulated DoS
  const accumulatedDoS = save.runtime.magic?.accumulatedDoS || 0;
  if (accumulatedDoS < check.castingNumberDoS) {
    // Not enough DoS accumulated
    return {
      checkId: check.id,
      actorId: actor.id,
      roll: 0,
      target: check.castingNumberDoS,
      success: false,
      dos: 0,
      dof: check.castingNumberDoS - accumulatedDoS,
      critical: "none",
      tags: [],
    };
  }

  const baseValue = getStatOrSkillValue(actor, check.key, save);

  // Apply focus bonuses for casting
  let castBonus = 0;
  const equipped = actor.equipment.equipped;
  const items = [equipped.weaponMainId, equipped.weaponOffId, equipped.armorId, ...equipped.accessoryIds].filter(
    (id): id is string => id !== null
  );

  for (const itemId of items) {
    const item = save.itemCatalogById[itemId];
    if (!item) continue;
    for (const mod of item.mods) {
      if (mod.type === "focus" && mod.castBonus) {
        castBonus += mod.castBonus;
      }
    }
  }

  const target = baseValue + castBonus;
  const result = rollD100Check(check.id, actor.id, target, storyPack, rng);

  // Magic effect requires both accumulated DoS >= CN AND successful roll with DoS >= CN
  if (result && result.success && result.dos < check.castingNumberDoS) {
    // Roll succeeded but didn't achieve required DoS
    return {
      ...result,
      success: false,
      dof: check.castingNumberDoS - result.dos,
    };
  }

  // Note: Magic DoS consumption is handled in engine.ts after the check
  return result;
}

/**
 * Rolls a D100 and evaluates success/failure
 */
function rollD100Check(checkId: string, actorId: string, target: number, storyPack: StoryPack, rng: RNG): CheckResult {
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
