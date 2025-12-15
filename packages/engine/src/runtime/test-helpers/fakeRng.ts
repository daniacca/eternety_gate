/**
 * FakeRng - Test helper that returns predefined D100 rolls
 * Implements the same interface as RNG for testing purposes
 */
export class FakeRng {
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
}

