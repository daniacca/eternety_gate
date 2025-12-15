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
} from './types';
import { RNG } from './rng';

/**
 * Resolves an ActorRef to an Actor
 */
export function resolveActor(
  actorRef: ActorRef | undefined,
  save: GameSave
): Actor | null {
  if (!actorRef) {
    return save.actorsById[save.party.activeActorId] || null;
  }

  switch (actorRef.mode) {
    case 'active':
      return save.actorsById[save.party.activeActorId] || null;

    case 'byId':
      return save.actorsById[actorRef.actorId] || null;

    case 'bestOfParty': {
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

    case 'askPlayer':
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
export function getStatOrSkillValue(
  actor: Actor,
  key: StatOrSkillKey,
  save: GameSave
): number {
  // Check if it's a stat
  if (key in actor.stats) {
    let value = actor.stats[key as keyof typeof actor.stats];
    
    // Apply equipment bonuses
    const equipped = actor.equipment.equipped;
    const items = [
      equipped.weaponMainId,
      equipped.weaponOffId,
      equipped.armorId,
      ...equipped.accessoryIds,
    ].filter((id): id is string => id !== null);

    for (const itemId of items) {
      const item = save.itemCatalogById[itemId];
      if (!item) continue;

      for (const mod of item.mods) {
        if (mod.type === 'bonusStat' && mod.stat === key) {
          value += mod.value;
        }
      }
    }

    // Apply temp modifiers
    for (const tempMod of actor.status.tempModifiers) {
      if (
        (tempMod.scope === 'check' || tempMod.scope === 'all') &&
        (!tempMod.key || tempMod.key === key)
      ) {
        value += tempMod.value;
      }
    }

    return value;
  }

  // Check if it's a skill (SKILL:xxx format)
  if (key.startsWith('SKILL:')) {
    const skillId = key.substring(6);
    let value = actor.skills[skillId] || 0;

    // Apply equipment bonuses
    const equipped = actor.equipment.equipped;
    const items = [
      equipped.weaponMainId,
      equipped.weaponOffId,
      equipped.armorId,
      ...equipped.accessoryIds,
    ].filter((id): id is string => id !== null);

    for (const itemId of items) {
      const item = save.itemCatalogById[itemId];
      if (!item) continue;

      for (const mod of item.mods) {
        if (mod.type === 'bonusSkill' && mod.skill === skillId) {
          value += mod.value;
        }
      }
    }

    // Apply temp modifiers
    for (const tempMod of actor.status.tempModifiers) {
      if (
        (tempMod.scope === 'check' || tempMod.scope === 'all') &&
        (!tempMod.key || tempMod.key === key)
      ) {
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
function resolveDifficulty(
  difficulty: string,
  storyPack: StoryPack
): number {
  const bands = storyPack.systems.checks.difficultyBands;
  return bands[difficulty] ?? 0;
}

/**
 * Performs a D100 check
 */
export function performCheck(
  check: Check,
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): CheckResult {
  switch (check.kind) {
    case 'single':
      return performSingleCheck(check, storyPack, save, rng);
    case 'multi':
      throw new Error(`Check kind 'multi' is not yet implemented in this vertical slice`);
    case 'opposed':
      throw new Error(`Check kind 'opposed' is not yet implemented in this vertical slice`);
    case 'sequence':
      throw new Error(`Check kind 'sequence' is not yet implemented in this vertical slice`);
    case 'magicChannel':
      throw new Error(`Check kind 'magicChannel' is not yet implemented in this vertical slice`);
    case 'magicEffect':
      throw new Error(`Check kind 'magicEffect' is not yet implemented in this vertical slice`);
    default:
      throw new Error(`Unknown check kind: ${(check as any).kind}`);
  }
}

function performSingleCheck(
  check: SingleCheck,
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): CheckResult {
  const actor = resolveActor(check.actorRef, save);
  if (!actor) return null;

  const baseValue = getStatOrSkillValue(actor, check.key, save);
  const difficultyMod = resolveDifficulty(check.difficulty, storyPack);
  const target = baseValue + difficultyMod;

  return rollD100Check(check.id, actor.id, target, storyPack, rng);
}

function performMultiCheck(
  check: MultiCheck,
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): CheckResult {
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

function performOpposedCheck(
  check: OpposedCheck,
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): CheckResult {
  const attacker = resolveActor(check.attacker.actorRef, save);
  const defender = resolveActor(check.defender.actorRef, save);
  if (!attacker || !defender) return null;

  const attackerValue = getStatOrSkillValue(attacker, check.attacker.key, save);
  const defenderValue = getStatOrSkillValue(defender, check.defender.key, save);

  const attackerDifficulty = check.attacker.difficulty
    ? resolveDifficulty(check.attacker.difficulty, storyPack)
    : 0;
  const defenderDifficulty = check.defender.difficulty
    ? resolveDifficulty(check.defender.difficulty, storyPack)
    : 0;

  const attackerTarget = attackerValue + attackerDifficulty;
  const defenderTarget = defenderValue + defenderDifficulty;

  const attackerRoll = rng.rollD100();
  const defenderRoll = rng.rollD100();

  const attackerResult = evaluateRoll(
    attackerRoll,
    attackerTarget,
    storyPack
  );
  const defenderResult = evaluateRoll(
    defenderRoll,
    defenderTarget,
    storyPack
  );

  if (!attackerResult || !defenderResult) {
    return null;
  }

  const attackerDoS = attackerResult.success ? attackerResult.dos : 0;
  const defenderDoS = defenderResult.success ? defenderResult.dos : 0;

  const success = attackerDoS > defenderDoS;

  // Use attacker's roll for the result
  return {
    checkId: check.id,
    actorId: attacker.id,
    roll: attackerRoll,
    target: attackerTarget,
    success,
    dos: success ? attackerDoS : 0,
    dof: success ? 0 : attackerResult.dof,
    critical: attackerResult.critical,
    tags: attackerResult.tags,
  };
}

function performSequenceCheck(
  check: SequenceCheck,
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): CheckResult {
  // Execute all steps, succeed only if all succeed
  for (const step of check.steps) {
    const result = performCheck(step, storyPack, save, rng);
    if (!result || !result.success) {
      return result || null;
    }
  }

  // All succeeded
  const lastStep = check.steps[check.steps.length - 1];
  const lastResult = performCheck(lastStep, storyPack, save, rng);
  return lastResult;
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
  const items = [
    equipped.weaponMainId,
    equipped.weaponOffId,
    equipped.armorId,
    ...equipped.accessoryIds,
  ].filter((id): id is string => id !== null);

  for (const itemId of items) {
    const item = save.itemCatalogById[itemId];
    if (!item) continue;
    for (const mod of item.mods) {
      if (mod.type === 'focus' && mod.channelBonus) {
        channelBonus += mod.channelBonus;
      }
    }
  }

  const target = baseValue + channelBonus;
  const result = rollD100Check(check.id, actor.id, target, storyPack, rng);

  // Note: Magic DoS accumulation is handled in engine.ts after the check
  return result;
}

function performMagicEffectCheck(
  check: MagicEffectCheck,
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): CheckResult {
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
      critical: 'none',
      tags: [],
    };
  }

  const baseValue = getStatOrSkillValue(actor, check.key, save);

  // Apply focus bonuses for casting
  let castBonus = 0;
  const equipped = actor.equipment.equipped;
  const items = [
    equipped.weaponMainId,
    equipped.weaponOffId,
    equipped.armorId,
    ...equipped.accessoryIds,
  ].filter((id): id is string => id !== null);

  for (const itemId of items) {
    const item = save.itemCatalogById[itemId];
    if (!item) continue;
    for (const mod of item.mods) {
      if (mod.type === 'focus' && mod.castBonus) {
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
function rollD100Check(
  checkId: string,
  actorId: string,
  target: number,
  storyPack: StoryPack,
  rng: RNG
): CheckResult {
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

  let critical: NonNullable<CheckResult>['critical'] = 'none';
  let success = false;
  let dos = 0;
  let dof = 0;
  const tags: string[] = [];

  // Check for auto-success
  if (autoSuccess.includes(roll)) {
    critical = 'autoSuccess';
    success = true;
    dos = Math.max(1, Math.floor((target - roll) / 10));
    
    // Check for epic success
    if (epic && roll === epic.success) {
      critical = 'epicSuccess';
      dos = epic.treatAsDoS;
      tags.push('epicSuccess');
    }
  }
  // Check for auto-fail
  else if (autoFail.includes(roll)) {
    critical = 'autoFail';
    success = false;
    dof = Math.max(1, Math.floor((roll - target) / 10));
    
    // Check for epic fail
    if (epic && roll === epic.fail) {
      critical = 'epicFail';
      dof = Math.max(1, Math.floor((roll - target) / 10));
      tags.push('epicFail');
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
    tags.push('doubles');
  }

  return {
    checkId: checkId || '',
    actorId: actorId || '',
    roll,
    target,
    success,
    dos,
    dof,
    critical,
    tags,
  };
}

