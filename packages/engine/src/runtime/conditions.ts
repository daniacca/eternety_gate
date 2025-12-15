import type { Condition, GameSave } from './types';

/**
 * Evaluates a condition against the game save state
 */
export function evaluateCondition(condition: Condition, save: GameSave): boolean {
  switch (condition.op) {
    case 'flag': {
      // Strip 'flags.' prefix if present since we're operating on the flags object
      const path = condition.path.startsWith('flags.') ? condition.path.substring(6) : condition.path;
      const value = getStateValue(save.state.flags, path);
      return value === condition.value;
    }

    case 'counterGte': {
      // Strip 'counters.' prefix if present since we're operating on the counters object
      const path = condition.path.startsWith('counters.') ? condition.path.substring(9) : condition.path;
      const value = getStateValue(save.state.counters, path);
      return typeof value === 'number' && value >= condition.value;
    }

    case 'counterLte': {
      // Strip 'counters.' prefix if present since we're operating on the counters object
      const path = condition.path.startsWith('counters.') ? condition.path.substring(9) : condition.path;
      const value = getStateValue(save.state.counters, path);
      return typeof value === 'number' && value <= condition.value;
    }

    case 'and': {
      return condition.clauses.every(clause => evaluateCondition(clause, save));
    }

    case 'or': {
      return condition.clauses.some(clause => evaluateCondition(clause, save));
    }

    case 'not': {
      return !evaluateCondition(condition.clause, save);
    }

    default:
      return false;
  }
}

/**
 * Evaluates multiple conditions (OR logic if array, single if not)
 */
export function evaluateConditions(
  conditions: Condition | Condition[],
  save: GameSave
): boolean {
  if (Array.isArray(conditions)) {
    return conditions.some(cond => evaluateCondition(cond, save));
  }
  return evaluateCondition(conditions, save);
}

/**
 * Gets a flat value from an object using a flat key (no nested path resolution)
 */
function getStateValue(obj: Record<string, any>, key: string): any {
  return obj[key];
}

