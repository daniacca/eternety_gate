import { describe, it, expect } from "vitest";
import { getModifierTotal } from "./modifiers";
import { getStatTestTarget } from "./bonuses";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import type { CharacterCatalogs, Trait } from "../../content/catalogs";

describe("modifiers", () => {
  describe("Unnatural Characteristic test scaling", () => {
    const storyPack = makeTestStoryPack();

    // Helper to create catalogs with unnatural characteristic trait
    function makeCatalogsWithUnnaturalTrait(): CharacterCatalogs {
      const trait: Trait = {
        id: "trait:unnatural_characteristic",
        name: "Caratteristica Innaturale",
        params: {
          stat: { type: "string", required: true },
          bonusX: { type: "number", required: true },
        },
        grants: [
          {
            type: "modifier",
            key: "stat.<stat>.bonusAdd",
            op: "add",
            valueRef: "bonusX",
          },
          {
            type: "modifier",
            key: "stat.<stat>.testAdd",
            op: "add",
            value: 0, // Explicit testAdd (will be overridden by derived rule)
          },
        ],
      };

      return {
        skills: [],
        talents: [],
        traits: [trait],
      };
    }

    it("should return 0 testAdd when bonusAdd = 1", () => {
      const catalogs = makeCatalogsWithUnnaturalTrait();
      const actor = makeTestActor({
        stats: { STR: 50 },
        traits: {
          "trait:unnatural_characteristic": { stat: "STR", bonusX: 1 },
        },
      });
      const save = makeTestSave(storyPack, actor);

      const bonusAdd = getModifierTotal(save, catalogs, actor.id, "stat.STR.bonusAdd");
      const testAdd = getModifierTotal(save, catalogs, actor.id, "stat.STR.testAdd");

      expect(bonusAdd).toBe(1);
      expect(testAdd).toBe(0); // floor(1/2)*10 = floor(0.5)*10 = 0*10 = 0
    });

    it("should return +10 testAdd when bonusAdd = 2", () => {
      const catalogs = makeCatalogsWithUnnaturalTrait();
      const actor = makeTestActor({
        stats: { STR: 50 },
        traits: {
          "trait:unnatural_characteristic": { stat: "STR", bonusX: 2 },
        },
      });
      const save = makeTestSave(storyPack, actor);

      const bonusAdd = getModifierTotal(save, catalogs, actor.id, "stat.STR.bonusAdd");
      const testAdd = getModifierTotal(save, catalogs, actor.id, "stat.STR.testAdd");

      expect(bonusAdd).toBe(2);
      expect(testAdd).toBe(10); // floor(2/2)*10 = floor(1)*10 = 1*10 = 10
    });

    it("should return +20 testAdd when bonusAdd = 4", () => {
      const catalogs = makeCatalogsWithUnnaturalTrait();
      const actor = makeTestActor({
        stats: { STR: 50 },
        traits: {
          "trait:unnatural_characteristic": { stat: "STR", bonusX: 4 },
        },
      });
      const save = makeTestSave(storyPack, actor);

      const bonusAdd = getModifierTotal(save, catalogs, actor.id, "stat.STR.bonusAdd");
      const testAdd = getModifierTotal(save, catalogs, actor.id, "stat.STR.testAdd");

      expect(bonusAdd).toBe(4);
      expect(testAdd).toBe(20); // floor(4/2)*10 = floor(2)*10 = 2*10 = 20
    });

    it("should return +10 testAdd when bonusAdd = 3 (floor behavior)", () => {
      const catalogs = makeCatalogsWithUnnaturalTrait();
      const actor = makeTestActor({
        stats: { STR: 50 },
        traits: {
          "trait:unnatural_characteristic": { stat: "STR", bonusX: 3 },
        },
      });
      const save = makeTestSave(storyPack, actor);

      const bonusAdd = getModifierTotal(save, catalogs, actor.id, "stat.STR.bonusAdd");
      const testAdd = getModifierTotal(save, catalogs, actor.id, "stat.STR.testAdd");

      expect(bonusAdd).toBe(3);
      expect(testAdd).toBe(10); // floor(3/2)*10 = floor(1.5)*10 = 1*10 = 10
    });

    it("should work with getStatTestTarget unchanged", () => {
      const catalogs = makeCatalogsWithUnnaturalTrait();
      const actor = makeTestActor({
        stats: { STR: 50 },
        traits: {
          "trait:unnatural_characteristic": { stat: "STR", bonusX: 4 },
        },
      });
      const save = makeTestSave(storyPack, actor);

      const testTarget = getStatTestTarget(save, catalogs, actor.id, "STR");

      // Base stat value (50) + testAdd modifier (20 from bonusAdd=4)
      expect(testTarget).toBe(70);
    });

    it("should handle multiple sources of bonusAdd correctly", () => {
      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [
          {
            id: "talent:test_bonus",
            name: "Test Bonus",
            tier: 1,
            xpCost: 100,
            prerequisites: [],
            grants: [
              {
                type: "modifier",
                key: "stat.STR.bonusAdd",
                op: "add",
                value: 1,
              },
            ],
            maxRank: 1,
          },
        ],
        traits: [
          {
            id: "trait:unnatural_characteristic",
            name: "Caratteristica Innaturale",
            params: {
              stat: { type: "string", required: true },
              bonusX: { type: "number", required: true },
            },
            grants: [
              {
                type: "modifier",
                key: "stat.<stat>.bonusAdd",
                op: "add",
                valueRef: "bonusX",
              },
              {
                type: "modifier",
                key: "stat.<stat>.testAdd",
                op: "add",
                value: 0,
              },
            ],
          },
        ],
      };

      const actor = makeTestActor({
        stats: { STR: 50 },
        talents: {
          "talent:test_bonus": 1,
        },
        traits: {
          "trait:unnatural_characteristic": { stat: "STR", bonusX: 3 },
        },
      });
      const save = makeTestSave(storyPack, actor);

      // Total bonusAdd = 1 (talent) + 3 (trait) = 4
      const bonusAdd = getModifierTotal(save, catalogs, actor.id, "stat.STR.bonusAdd");
      // testAdd should be floor(4/2)*10 = 20
      const testAdd = getModifierTotal(save, catalogs, actor.id, "stat.STR.testAdd");

      expect(bonusAdd).toBe(4);
      expect(testAdd).toBe(20);
    });

    it("should not cause infinite recursion", () => {
      const catalogs = makeCatalogsWithUnnaturalTrait();
      const actor = makeTestActor({
        stats: { STR: 50 },
        traits: {
          "trait:unnatural_characteristic": { stat: "STR", bonusX: 10 },
        },
      });
      const save = makeTestSave(storyPack, actor);

      // This should complete without stack overflow
      const bonusAdd = getModifierTotal(save, catalogs, actor.id, "stat.STR.bonusAdd");
      const testAdd = getModifierTotal(save, catalogs, actor.id, "stat.STR.testAdd");

      expect(bonusAdd).toBe(10);
      expect(testAdd).toBe(50); // floor(10/2)*10 = 5*10 = 50
    });
  });
});

