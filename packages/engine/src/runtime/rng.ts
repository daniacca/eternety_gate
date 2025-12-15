/**
 * Simple deterministic RNG using seed and counter
 * Based on mulberry32 PRNG for better distribution
 * Seed remains constant; counter advances for seekability
 */
export class RNG {
  private readonly seed: number;
  private counter: number;

  constructor(seed: number, counter: number = 0) {
    this.seed = seed;
    this.counter = counter;
  }

  /**
   * Pure PRNG function that takes seed + counter and returns a value
   * Does not mutate seed, making it seekable
   */
  private mulberry32(seed: number): number {
    let t = seed + 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generates next random number in range [0, 1)
   * Increments counter but does not mutate seed
   */
  next(): number {
    const n = this.mulberry32((this.seed >>> 0) + (this.counter >>> 0));
    this.counter++;
    return n;
  }

  /**
   * Generates random integer in range [min, max] (inclusive)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Rolls a D100 (1-100)
   */
  rollD100(): number {
    return this.nextInt(1, 100);
  }

  /**
   * Gets current counter value
   */
  getCounter(): number {
    return this.counter;
  }

  /**
   * Gets current seed (always returns the original seed)
   */
  getSeed(): number {
    return this.seed;
  }
}

import type { GameSave } from "./types";

/**
 * Utility function to roll D100 and update save state
 * Returns the roll and the updated save with incremented rngCounter
 * NOTE: debug/helper function; DO NOT USE inside engine flow, otherwise
 * it will instantiate a new RNG for each roll, which will break determinism
 */
export function rollD100(save: GameSave): {
  roll: number;
  nextSave: GameSave;
} {
  const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);
  const roll = rng.rollD100();

  return {
    roll,
    nextSave: {
      ...save,
      runtime: {
        ...save.runtime,
        rngCounter: rng.getCounter(),
      },
    },
  };
}
