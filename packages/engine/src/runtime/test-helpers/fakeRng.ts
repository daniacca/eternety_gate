import type { IRNG } from '../rng';

/**
 * FakeRng - Test helper that returns predefined D100 rolls
 * Implements the same interface as RNG for testing purposes
 */
export class FakeRng implements IRNG {
  private rolls: number[];
  private index: number = 0;
  private counter: number = 0;

  constructor(rolls: number[]) {
    this.rolls = [...rolls];
  }

  /**
   * Returns the next predefined roll
   * Throws if rolls are exhausted
   */
  rollD100(): number {
    if (this.index >= this.rolls.length) {
      throw new Error(`FakeRng: No more rolls available. Requested roll ${this.index + 1}, but only ${this.rolls.length} rolls provided.`);
    }
    const roll = this.rolls[this.index];
    this.index++;
    this.counter++;
    return roll;
  }

  /**
   * Returns next random number (for compatibility with RNG interface)
   */
  next(): number {
    // Convert D100 roll to 0..1 range for compatibility
    const roll = this.rollD100();
    return (roll - 1) / 99;
  }

  /**
   * Returns current counter value
   */
  getCounter(): number {
    return this.counter;
  }

  /**
   * Returns seed (always 0 for FakeRng)
   */
  getSeed(): number {
    return 0;
  }

  /**
   * Generates random integer in range [min, max] (for compatibility)
   */
  nextInt(min: number, max: number): number {
    const roll = this.rollD100();
    // Map roll (1-100) to the requested range
    return Math.floor(((roll - 1) / 99) * (max - min + 1)) + min;
  }

  /**
   * Helper: Calculate what D100 roll would produce a desired nextInt value
   * For nextInt(min, max), to get value 'desired':
   *   desired = floor(((roll - 1) / 99) * (max - min + 1)) + min
   * Returns a value in [1, 100] that will produce the desired result
   */
  static d100ForNextInt(desired: number, min: number, max: number): number {
    const range = max - min + 1;
    // We want: desired = floor(((roll - 1) / 99) * range) + min
    // So: (desired - min) <= ((roll - 1) / 99) * range < (desired - min + 1)
    //     (desired - min) / range * 99 <= roll - 1 < (desired - min + 1) / range * 99
    //     (desired - min) / range * 99 + 1 <= roll < (desired - min + 1) / range * 99 + 1
    // Use the midpoint to get a reliable value
    const rollValue = Math.floor(((desired - min + 0.5) / range) * 99) + 1;
    return Math.max(1, Math.min(100, rollValue));
  }
}

