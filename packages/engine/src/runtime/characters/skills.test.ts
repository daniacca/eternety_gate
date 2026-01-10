import { describe, it, expect } from "vitest";
import { getSkillTarget } from "./skills";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import type { CharacterCatalogs, Skill } from "../../content/catalogs";

describe("skills", () => {
  const storyPack = makeTestStoryPack();

  describe("getSkillTarget", () => {
    it("should return base stat + (rank * 5) when no modifiers", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          WS: 50, // base value = 50
        },
        skills: {
          "skill:parry": 2, // rank 2 = +10
        },
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [
          {
            id: "skill:parry",
            name: "Parry",
            baseStat: "WS",
          },
        ],
        talents: [],
        traits: [],
      };

      // Base (50) + rank bonus (2 * 5 = 10) = 60
      expect(getSkillTarget(save, catalogs, "PC_1", "skill:parry")).toBe(60);
    });

    it("should return 0 when actor not found", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [
          {
            id: "skill:parry",
            name: "Parry",
            baseStat: "WS",
          },
        ],
        talents: [],
        traits: [],
      };

      expect(getSkillTarget(save, catalogs, "NPC_1", "skill:parry")).toBe(0);
    });

    it("should return 0 when skill not found", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          WS: 50,
        },
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [],
      };

      expect(getSkillTarget(save, catalogs, "PC_1", "skill:parry")).toBe(0);
    });

    it("should handle rank 0 skill", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          WS: 50,
        },
        skills: {
          "skill:parry": 0,
        },
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [
          {
            id: "skill:parry",
            name: "Parry",
            baseStat: "WS",
          },
        ],
        talents: [],
        traits: [],
      };

      // Base (50) + rank bonus (0 * 5 = 0) = 50
      expect(getSkillTarget(save, catalogs, "PC_1", "skill:parry")).toBe(50);
    });

    it("should handle missing skill rank (defaults to 0)", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          WS: 50,
        },
        skills: {},
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [
          {
            id: "skill:parry",
            name: "Parry",
            baseStat: "WS",
          },
        ],
        talents: [],
        traits: [],
      };

      // Base (50) + rank bonus (0 * 5 = 0) = 50
      expect(getSkillTarget(save, catalogs, "PC_1", "skill:parry")).toBe(50);
    });

    it("should include skill modifiers when present", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          WS: 50,
        },
        skills: {
          "skill:parry": 2,
        },
        talents: {
          "talent:weapon_skill": 1,
        },
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [
          {
            id: "skill:parry",
            name: "Parry",
            baseStat: "WS",
          },
        ],
        talents: [
          {
            id: "talent:weapon_skill",
            name: "Weapon Skill",
            grants: [
              {
                type: "modifier",
                key: "skill.skill:parry.testAdd",
                op: "add",
                value: 5,
              },
            ],
            tier: 1,
            xpCost: 0,
            prerequisites: [],
          },
        ],
        traits: [],
      };

      // Base (50) + rank bonus (10) + modifier (5) = 65
      expect(getSkillTarget(save, catalogs, "PC_1", "skill:parry")).toBe(65);
    });
  });
});
