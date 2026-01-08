import type { Effect, GameSave } from "../types";

/**
 * Gets a flat value from an object using a flat key (no nested path resolution)
 */
function getFlatValue(obj: Record<string, any>, key: string): any {
  return obj[key];
}

/**
 * Sets a flat value in an object using a flat key (no nested path resolution)
 */
function setFlatValue(obj: Record<string, any>, key: string, value: any): void {
  obj[key] = value;
}

export function applySetFlag(effect: Extract<Effect, { op: "setFlag" }>, save: GameSave): GameSave {
  const newFlags = { ...save.state.flags };
  // Strip 'flags.' prefix if present since we're operating on the flags object
  // After stripping, treat as flat key (no nested path resolution)
  const key = effect.path.startsWith("flags.") ? effect.path.substring(6) : effect.path;
  setFlatValue(newFlags, key, effect.value);

  return {
    ...save,
    state: {
      ...save.state,
      flags: newFlags,
    },
  };
}

export function applyAddCounter(effect: Extract<Effect, { op: "addCounter" }>, save: GameSave): GameSave {
  const newCounters = { ...save.state.counters };
  // Strip 'counters.' prefix if present since we're operating on the counters object
  // After stripping, treat as flat key (no nested path resolution)
  const key = effect.path.startsWith("counters.") ? effect.path.substring(9) : effect.path;
  const currentValue = getFlatValue(newCounters, key) || 0;
  setFlatValue(newCounters, key, currentValue + effect.value);

  return {
    ...save,
    state: {
      ...save.state,
      counters: newCounters,
    },
  };
}

