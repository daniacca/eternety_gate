/**
 * Simple deterministic RNG using seed and counter
 * Based on Linear Congruential Generator
 */
export class RNG {
  private seed: number;
  private counter: number;

  constructor(seed: number, counter: number = 0) {
    this.seed = seed;
    this.counter = counter;
  }

  /**
   * Generates next random number in range [0, 1)
   */
  next(): number {
    // LCG parameters (same as used in many games)
    const a = 1664525;
    const c = 1013904223;
    const m = Math.pow(2, 32);
    
    this.seed = (a * this.seed + c) % m;
    this.counter++;
    
    return this.seed / m;
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
   * Gets current seed
   */
  getSeed(): number {
    return this.seed;
  }
}

