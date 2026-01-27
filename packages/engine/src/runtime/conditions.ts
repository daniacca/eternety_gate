import type { Actor, ConditionId, ConditionInstance, Condition, GameSave } from "./types";

/**
 * Evaluates a single story condition (flags, counters, etc.)
 */
export function evaluateCondition(condition: Condition, save: GameSave): boolean {
  switch (condition.op) {
    case "flag": {
      const key = condition.path.startsWith("flags.") ? condition.path.substring(6) : condition.path;
      const value = save.state.flags[key];
      return value === condition.value;
    }

    case "counterGte": {
      const key = condition.path.startsWith("counters.") ? condition.path.substring(9) : condition.path;
      const value = save.state.counters[key] ?? 0;
      return value >= condition.value;
    }

    case "counterLte": {
      const key = condition.path.startsWith("counters.") ? condition.path.substring(9) : condition.path;
      const value = save.state.counters[key] ?? 0;
      return value <= condition.value;
    }

    case "and": {
      return condition.clauses.every((clause) => evaluateCondition(clause, save));
    }

    case "or": {
      return condition.clauses.some((clause) => evaluateCondition(clause, save));
    }

    case "not": {
      return !evaluateCondition(condition.clause, save);
    }
  }
}

/**
 * Evaluates a condition or array of conditions (OR logic for arrays)
 */
export function evaluateConditions(conditions: Condition | Condition[], save: GameSave): boolean {
  if (Array.isArray(conditions)) {
    return conditions.some((condition) => evaluateCondition(condition, save));
  }
  return evaluateCondition(conditions, save);
}

/**
 * Checks if an actor has a specific condition
 */
export function hasCondition(actor: Actor, condition: ConditionId): boolean {
  return actor.conditions?.[condition] !== undefined;
}

/**
 * Gets a condition instance from an actor, or null if not present
 */
export function getCondition(actor: Actor, condition: ConditionId): ConditionInstance | null {
  return actor.conditions?.[condition] ?? null;
}

/**
 * Gets the stacks count for a condition (defaults to 1 if not specified)
 */
export function getStacks(actor: Actor, condition: ConditionId): number {
  const instance = getCondition(actor, condition);
  return instance?.stacks ?? 1;
}

/**
 * Adds a condition to an actor immutably
 */
export function addConditionToActor(
  actor: Actor,
  condition: ConditionId,
  stacks?: number,
  untilTurnCounter?: number,
  source?: string,
  params?: Record<string, any>
): Actor {
  if (
    condition === "bleeding" &&
    (actor.traits?.["trait:undying"] !== undefined || actor.traits?.["trait:machine"] !== undefined)
  ) {
    return actor;
  }
  if (
    (condition === "stunned" || condition === "shock") &&
    actor.traits?.["trait:from_beyond"] !== undefined
  ) {
    return actor;
  }

  const existingInstance = actor.conditions?.[condition];
  const newInstance: ConditionInstance = {
    stacks: stacks ?? existingInstance?.stacks ?? 1,
    untilTurnCounter,
    source: source ?? existingInstance?.source,
    params: params ?? existingInstance?.params,
  };

  return {
    ...actor,
    conditions: {
      ...actor.conditions,
      [condition]: newInstance,
    },
  };
}

/**
 * Removes a condition from an actor immutably
 */
export function removeConditionFromActor(actor: Actor, condition: ConditionId): Actor {
  if (!actor.conditions?.[condition]) {
    return actor; // Already doesn't have the condition
  }

  const newConditions = { ...actor.conditions };
  delete newConditions[condition];

  return {
    ...actor,
    conditions: Object.keys(newConditions).length > 0 ? newConditions : undefined,
  };
}

/**
 * Computes combat modifiers from conditions
 * Returns modifiers that affect to-hit, movement, and defensive actions
 * 
 * @param actor - The actor to compute modifiers for
 * @param fatiguePenaltyReduction - Optional number of fatigue tiers to ignore (from Relentless talent)
 */
export function computeCombatModifiersFromConditions(
  actor: Actor,
  fatiguePenaltyReduction: number = 0
): {
  toHitBonus?: number;
  toHitPenalty?: number;
  moveDelta?: number;
  allowParry?: boolean;
  allowDodge?: boolean;
} {
  let toHitPenalty = 0;
  let moveDelta = 0;
  let allowParry = true;
  let allowDodge = true;

  // Fatigue: -10 per stack to to-hit (capped at -30), -1 move per stack
  // Relentless talent: reduce penalty tier by fatiguePenaltyReduction (ignore first N -10 thresholds)
  if (hasCondition(actor, "fatigue")) {
    const fatigueStacks = getStacks(actor, "fatigue");
    // Apply Relentless talent reduction (reduces effective stacks for penalty calculation)
    const effectiveFatigueStacks = Math.max(0, fatigueStacks - fatiguePenaltyReduction);
    
    const fatiguePenalty = Math.min(effectiveFatigueStacks * 10, 30);
    toHitPenalty += fatiguePenalty;
    moveDelta -= fatigueStacks; // Movement penalty is NOT reduced by Relentless
  }

  // Prone: -1 move
  if (hasCondition(actor, "prone")) {
    moveDelta -= 1;
  }

  // Stunned: no parry/dodge
  if (hasCondition(actor, "stunned")) {
    allowParry = false;
    allowDodge = false;
  }

  // Frenzy: no parry
  if (hasCondition(actor, "frenzy")) {
    allowParry = false;
  }

  // Bound: -20 to melee (attack/parry/dodge)
  // Note: Movement blocking is handled in advanceCombatTurn (moveRemaining=0 + escape attempt)
  if (hasCondition(actor, "bound")) {
    toHitPenalty += 20;
  }

  return {
    toHitPenalty: toHitPenalty > 0 ? toHitPenalty : undefined,
    moveDelta: moveDelta !== 0 ? moveDelta : undefined,
    allowParry: allowParry ? undefined : false,
    allowDodge: allowDodge ? undefined : false,
  };
}
