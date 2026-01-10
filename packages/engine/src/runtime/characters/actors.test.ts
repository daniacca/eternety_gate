import { describe, it, expect } from "vitest";
import { isActorAlive, getSizeMovementModifier } from "./actors";
import { makeTestActor } from "../test-helpers/makeTestActor";

describe("actors", () => {
  describe("isActorAlive", () => {
    it("should return true for alive actor", () => {
      const actor = makeTestActor({
        resources: { wounds: 0, rf: 0, peq: 0, isDead: false },
      });
      expect(isActorAlive(actor)).toBe(true);
    });

    it("should return false for dead actor (isDead: true)", () => {
      const actor = makeTestActor({
        resources: { wounds: 0, rf: 0, peq: 0, isDead: true },
      });
      expect(isActorAlive(actor)).toBe(false);
    });

    it("should return true when isDead is undefined", () => {
      const actor = makeTestActor({
        resources: { wounds: 0, rf: 0, peq: 0 },
      });
      expect(isActorAlive(actor)).toBe(true);
    });

    it("should return false for undefined actor", () => {
      expect(isActorAlive(undefined)).toBe(false);
    });
  });

  describe("getSizeMovementModifier", () => {
    it("should return -3 for size 1", () => {
      const actor = makeTestActor({
        traits: {
          "trait:size": { size: 1 },
        },
      });
      expect(getSizeMovementModifier(actor)).toBe(-3);
    });

    it("should return 0 for size 4 (default)", () => {
      const actor = makeTestActor({
        traits: {
          "trait:size": { size: 4 },
        },
      });
      expect(getSizeMovementModifier(actor)).toBe(0);
    });

    it("should return +6 for size 10", () => {
      const actor = makeTestActor({
        traits: {
          "trait:size": { size: 10 },
        },
      });
      expect(getSizeMovementModifier(actor)).toBe(6);
    });

    it("should default to size 4 when no size trait is present", () => {
      const actor = makeTestActor({
        traits: {},
      });
      expect(getSizeMovementModifier(actor)).toBe(0);
    });

    it("should default to size 4 when size trait has invalid structure", () => {
      const actor = makeTestActor({
        traits: {
          "trait:size": "invalid" as any,
        },
      });
      expect(getSizeMovementModifier(actor)).toBe(0);
    });

    it("should return 0 for size out of range", () => {
      const actor = makeTestActor({
        traits: {
          "trait:size": { size: 99 },
        },
      });
      expect(getSizeMovementModifier(actor)).toBe(0);
    });

    it("should handle all valid sizes correctly", () => {
      const sizeTable: Record<number, number> = {
        1: -3,
        2: -2,
        3: -1,
        4: 0,
        5: 1,
        6: 2,
        7: 3,
        8: 4,
        9: 5,
        10: 6,
      };

      for (const [size, expectedModifier] of Object.entries(sizeTable)) {
        const actor = makeTestActor({
          traits: {
            "trait:size": { size: Number(size) },
          },
        });
        expect(getSizeMovementModifier(actor)).toBe(expectedModifier);
      }
    });
  });
});
