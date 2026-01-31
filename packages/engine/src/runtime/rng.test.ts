import { describe, it, expect } from "vitest";
import { RNG, rollD100 } from "./rng";
import { makeTestSave } from "./test-helpers/makeTestSave";
import { makeTestStoryPack } from "./test-helpers/makeTestStoryPack";
import { makeTestActor } from "./test-helpers/makeTestActor";

describe("RNG", () => {
  describe("determinism", () => {
    it("should produce the same sequence with the same seed", () => {
      const rng1 = new RNG(12345, 0);
      const rng2 = new RNG(12345, 0);

      const rolls1: number[] = [];
      const rolls2: number[] = [];

      for (let i = 0; i < 10; i++) {
        rolls1.push(rng1.rollD100());
        rolls2.push(rng2.rollD100());
      }

      expect(rolls1).toEqual(rolls2);
    });

    it("should produce different sequences with different seeds", () => {
      const rng1 = new RNG(12345, 0);
      const rng2 = new RNG(67890, 0);

      const rolls1: number[] = [];
      const rolls2: number[] = [];

      for (let i = 0; i < 10; i++) {
        rolls1.push(rng1.rollD100());
        rolls2.push(rng2.rollD100());
      }

      expect(rolls1).not.toEqual(rolls2);
    });

    it("should produce different sequences with different counters", () => {
      const rng1 = new RNG(12345, 0);
      const rng2 = new RNG(12345, 5);

      const rolls1: number[] = [];
      const rolls2: number[] = [];

      for (let i = 0; i < 10; i++) {
        rolls1.push(rng1.rollD100());
        rolls2.push(rng2.rollD100());
      }

      expect(rolls1).not.toEqual(rolls2);
    });
  });

  describe("rollD100", () => {
    it("should return values between 1 and 100", () => {
      const rng = new RNG(12345, 0);

      for (let i = 0; i < 100; i++) {
        const roll = rng.rollD100();
        expect(roll).toBeGreaterThanOrEqual(1);
        expect(roll).toBeLessThanOrEqual(100);
      }
    });

    it("should produce diverse results over many rolls", () => {
      const rng = new RNG(12345, 0);
      const rolls = new Set<number>();

      for (let i = 0; i < 1000; i++) {
        rolls.add(rng.rollD100());
      }

      // Should have at least some diversity (not all the same value)
      expect(rolls.size).toBeGreaterThan(1);
    });
  });

  describe("nextInt", () => {
    it("should return values within the specified range", () => {
      const rng = new RNG(12345, 0);

      for (let i = 0; i < 100; i++) {
        const value = rng.nextInt(1, 10);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(10);
      }
    });

    it("should handle single value range", () => {
      const rng = new RNG(12345, 0);
      const value = rng.nextInt(5, 5);
      expect(value).toBe(5);
    });

    it("should handle negative ranges", () => {
      const rng = new RNG(12345, 0);
      const value = rng.nextInt(-10, -5);
      expect(value).toBeGreaterThanOrEqual(-10);
      expect(value).toBeLessThanOrEqual(-5);
    });
  });

  describe("next", () => {
    it("should return values between 0 and 1", () => {
      const rng = new RNG(12345, 0);

      for (let i = 0; i < 100; i++) {
        const value = rng.next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });
  });

  describe("getCounter", () => {
    it("should return initial counter value", () => {
      const rng = new RNG(12345, 0);
      expect(rng.getCounter()).toBe(0);
    });

    it("should return incremented counter after rolls", () => {
      const rng = new RNG(12345, 0);
      rng.rollD100();
      expect(rng.getCounter()).toBe(1);
      rng.rollD100();
      expect(rng.getCounter()).toBe(2);
    });

    it("should return custom initial counter", () => {
      const rng = new RNG(12345, 10);
      expect(rng.getCounter()).toBe(10);
    });
  });

  describe("getSeed", () => {
    it("should return the original seed", () => {
      const rng = new RNG(12345, 0);
      expect(rng.getSeed()).toBe(12345);
    });

    it("should return seed even after many rolls", () => {
      const rng = new RNG(12345, 0);
      for (let i = 0; i < 100; i++) {
        rng.rollD100();
      }
      expect(rng.getSeed()).toBe(12345);
    });
  });

  describe("seekability", () => {
    it("should allow seeking by creating new RNG with different counter", () => {
      const rng1 = new RNG(12345, 0);
      const _roll1 = rng1.rollD100();
      const roll2 = rng1.rollD100();
      const roll3 = rng1.rollD100();

      // Create new RNG starting at counter 1 (skipping first roll)
      const rng2 = new RNG(12345, 1);
      const roll2FromRng2 = rng2.rollD100();
      const roll3FromRng2 = rng2.rollD100();

      expect(roll2FromRng2).toBe(roll2);
      expect(roll3FromRng2).toBe(roll3);
    });
  });
});

describe("rollD100 utility", () => {
  it("should roll D100 and update save counter", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor();
    const save = makeTestSave(storyPack, actor, 12345, 0);

    const result = rollD100(save);

    expect(result.roll).toBeGreaterThanOrEqual(1);
    expect(result.roll).toBeLessThanOrEqual(100);
    expect(result.nextSave.runtime.rngCounter).toBe(1);
  });

  it("should increment counter correctly", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor();
    const save = makeTestSave(storyPack, actor, 12345, 5);

    const result = rollD100(save);

    expect(result.nextSave.runtime.rngCounter).toBe(6);
  });

  it("should preserve other save properties", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor();
    const save = makeTestSave(storyPack, actor, 12345, 0);

    const result = rollD100(save);

    expect(result.nextSave.runtime.currentSceneId).toBe(save.runtime.currentSceneId);
    expect(result.nextSave.party).toEqual(save.party);
    expect(result.nextSave.state).toEqual(save.state);
  });
});

