import type { Condition, GameSave } from './types';

/**
 * Evaluates a condition against the game save state
 */
export function evaluateCondition(condition: Condition, save: GameSave): boolean {
  switch (condition.op) {
    case 'flag': {
      const value = getStateValue(save.state.flags, condition.path);
      return value === condition.value;
    }

    case 'counterGte': {
      const value = getStateValue(save.state.counters, condition.path);
      return typeof value === 'number' && value >= condition.value;
    }

    case 'counterLte': {
      const value = getStateValue(save.state.counters, condition.path);
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
 * Gets a nested value from an object using dot notation path
 */
function getStateValue(obj: Record<string, any>, path: string): any {
  const parts = path.split('.');
  let current: any = obj;
  
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  
  return current;
}

