import { describe, it, expect } from "vitest";
import { getRangedDamageBonusFromMightyShot } from "./mightyShot";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import type { CharacterCatalogs, Talent } from "../../content/catalogs";

describe("mightyShot", () => {
  const storyPack = makeTestStoryPack();

  describe("getRangedDamageBonusFromMightyShot", () => {
    it("should return 0 when rank is 0", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          BS: 50, // bonus = 5
        },
        talents: {},
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [],
      };

      expect(getRangedDamageBonusFromMightyShot(save, catalogs, "PC_1")).toBe(0);
    });

    it("should return ceil(BS_bonus/2) for rank 1", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          BS: 50, // bonus = 5
        },
        talents: {
          "talent:mighty_shot": 1,
        },
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [
          {
            id: "talent:mighty_shot",
            name: "Mighty Shot",
            grants: [
              {
                type: "modifier",
                key: "combat.rangedDamageFlatFromBSBonusRank",
                op: "add",
                value: 1,
              },
            ],
            tier: 2,
            xpCost: 1000,
            prerequisites: [],
          },
        ],
        traits: [],
      };

      // ceil(5/2) = 3
      expect(getRangedDamageBonusFromMightyShot(save, catalogs, "PC_1")).toBe(3);
    });

    it("should return BS_bonus for rank >= 2", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          BS: 50, // bonus = 5
        },
        talents: {
          "talent:mighty_shot": 2,
        },
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [
          {
            id: "talent:mighty_shot",
            name: "Mighty Shot",
            grants: [
              {
                type: "modifier",
                key: "combat.rangedDamageFlatFromBSBonusRank",
                op: "add",
                value: 2,
              },
            ],
            tier: 1,
            xpCost: 0,
            prerequisites: [],
          },
        ],
        traits: [],
      };

      // BS bonus = 5
      expect(getRangedDamageBonusFromMightyShot(save, catalogs, "PC_1")).toBe(5);
    });

    it("should handle odd BS bonus values correctly for rank 1", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          BS: 51, // bonus = 5 (floor(51/10))
        },
        talents: {
          "talent:mighty_shot": 1,
        },
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [
          {
            id: "talent:mighty_shot",
            name: "Mighty Shot",
            grants: [
              {
                type: "modifier",
                key: "combat.rangedDamageFlatFromBSBonusRank",
                op: "add",
                value: 1,
              },
            ],
            tier: 1,
            xpCost: 0,
            prerequisites: [],
          },
        ],
        traits: [],
      };

      // ceil(5/2) = 3
      expect(getRangedDamageBonusFromMightyShot(save, catalogs, "PC_1")).toBe(3);
    });

    it("should handle high BS bonus values", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          BS: 100, // bonus = 10
        },
        talents: {
          "talent:mighty_shot": 1,
        },
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [
          {
            id: "talent:mighty_shot",
            name: "Mighty Shot",
            grants: [
              {
                type: "modifier",
                key: "combat.rangedDamageFlatFromBSBonusRank",
                op: "add",
                value: 1,
              },
            ],
            tier: 1,
            xpCost: 0,
            prerequisites: [],
          },
        ],
        traits: [],
      };

      // ceil(10/2) = 5
      expect(getRangedDamageBonusFromMightyShot(save, catalogs, "PC_1")).toBe(5);
    });
  });
});
