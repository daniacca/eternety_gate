import { describe, it, expect } from "vitest";
import { calculateMaxHp, calculateMaxRf, getCurrentHp } from "./hp";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import type { CharacterCatalogs, Talent } from "../../content/catalogs";

describe("hp", () => {
  const storyPack = makeTestStoryPack();

  describe("calculateMaxHp", () => {
    it("should calculate max HP from STR, TOU, and WIL bonuses", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50, // bonus = 5
          TOU: 60, // bonus = 6
          WIL: 40, // bonus = 4
        },
      });
      const save = makeTestSave(storyPack, actor);

      // Formula: STR bonus + (2 * TOU bonus) + WIL bonus = 5 + (2 * 6) + 4 = 21
      expect(calculateMaxHp(save, actor)).toBe(21);
    });

    it("should return at least 1 HP even with low stats", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 0, // bonus = 0
          TOU: 0, // bonus = 0
          WIL: 0, // bonus = 0
        },
      });
      const save = makeTestSave(storyPack, actor);

      expect(calculateMaxHp(save, actor)).toBe(1);
    });

    it("should include Sound Constitution talent bonus", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50, // bonus = 5
          TOU: 50, // bonus = 5
          WIL: 50, // bonus = 5
        },
        talents: {
          "talent:sound_constitution": 2, // rank 2
        },
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [
          {
            id: "talent:sound_constitution",
            name: "Sound Constitution",
            grants: [
              {
                type: "hpMaxFlat",
                value: 2, // 2 HP per rank
              },
            ],
            tier: 1,
            xpCost: 0,
            prerequisites: [],
          },
        ],
        traits: [],
      };

      // Base: 5 + (2 * 5) + 5 = 20
      // Sound Constitution: 2 * 2 = 4
      // Total: 24
      expect(calculateMaxHp(save, actor, catalogs)).toBe(24);
    });

    it("should not include Sound Constitution if catalogs not provided", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        talents: {
          "talent:sound_constitution": 2,
        },
      });
      const save = makeTestSave(storyPack, actor);

      // Without catalogs, Sound Constitution is ignored
      expect(calculateMaxHp(save, actor)).toBe(20);
    });

    it("should handle high stat values correctly", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 100, // bonus = 10
          TOU: 90, // bonus = 9
          WIL: 80, // bonus = 8
        },
      });
      const save = makeTestSave(storyPack, actor);

      // 10 + (2 * 9) + 8 = 36
      expect(calculateMaxHp(save, actor)).toBe(36);
    });
  });

  describe("calculateMaxRf", () => {
    it("should calculate max RF as 3 * maxHp", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50, // bonus = 5
          TOU: 50, // bonus = 5
          WIL: 50, // bonus = 5
        },
      });
      const save = makeTestSave(storyPack, actor);

      // maxHp = 5 + (2 * 5) + 5 = 20
      // maxRf = 3 * 20 = 60
      expect(calculateMaxRf(save, actor)).toBe(60);
    });

    it("should use catalogs for maxHp calculation when provided", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        talents: {
          "talent:sound_constitution": 1,
        },
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [
          {
            id: "talent:sound_constitution",
            name: "Sound Constitution",
            grants: [{ type: "hpMaxFlat", value: 2 }],
            tier: 1,
            xpCost: 0,
            prerequisites: [],
          },
        ],
        traits: [],
      };

      // maxHp = 20 + 2 = 22
      // maxRf = 3 * 22 = 66
      expect(calculateMaxRf(save, actor, catalogs)).toBe(66);
    });
  });

  describe("getCurrentHp", () => {
    it("should calculate current HP as maxHp - wounds", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 5,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);

      // maxHp = 20, wounds = 5, currentHp = 15
      expect(getCurrentHp(save, actor)).toBe(15);
    });

    it("should return 0 when wounds >= maxHp", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 25, // exceeds maxHp of 20
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);

      expect(getCurrentHp(save, actor)).toBe(0);
    });

    it("should handle undefined wounds as 0", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: undefined as any,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);

      expect(getCurrentHp(save, actor)).toBe(20);
    });

    it("should use catalogs for maxHp calculation", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 10,
          rf: 0,
          peq: 0,
        },
        talents: {
          "talent:sound_constitution": 1,
        },
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [
          {
            id: "talent:sound_constitution",
            name: "Sound Constitution",
            grants: [{ type: "hpMaxFlat", value: 2 }],
            tier: 1,
            xpCost: 0,
            prerequisites: [],
          },
        ],
        traits: [],
      };

      // maxHp = 22, wounds = 10, currentHp = 12
      expect(getCurrentHp(save, actor, catalogs)).toBe(12);
    });
  });
});
