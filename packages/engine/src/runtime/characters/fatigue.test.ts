import { describe, it, expect } from "vitest";
import { getFatigueMax, applyFatigue } from "./fatigue";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import { hasCondition } from "../conditions";
import type { CharacterCatalogs } from "../../content/catalogs";

describe("fatigue", () => {
  const storyPack = makeTestStoryPack();

  describe("getFatigueMax", () => {
    it("should return 3 * maxHp", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50, // bonus = 5
          TOU: 50, // bonus = 5
          WIL: 50, // bonus = 5
        },
      });
      const save = makeTestSave(storyPack, actor);

      // maxHp = 20, maxRf = 60
      expect(getFatigueMax(save, actor)).toBe(60);
    });
  });

  describe("applyFatigue", () => {
    it("should return unchanged save when actor not found", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);

      const result = applyFatigue(save, "NPC_1", 10);
      expect(result).toBe(save);
    });

    it("should add RF without applying modifiers when RF <= HP", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 0,
          rf: 0,
          peq: 100,
        },
      });
      const save = makeTestSave(storyPack, actor);

      // maxHp = 20, adding 10 RF (still <= 20)
      const result = applyFatigue(save, "PC_1", 10);
      expect(result.actorsById["PC_1"].resources.rf).toBe(10);
      expect(result.actorsById["PC_1"].status.tempModifiers).toEqual([]);
    });

    it("should not apply fatigue while in frenzy", () => {
      const actor = makeTestActor({
        id: "PC_1",
        conditions: { frenzy: {} },
        resources: {
          wounds: 0,
          rf: 0,
          peq: 100,
        },
      });
      const save = makeTestSave(storyPack, actor);

      const result = applyFatigue(save, "PC_1", 10);

      expect(result).toBe(save);
    });

    it("should apply -10 modifier when crossing RF > HP threshold", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 0,
          rf: 15, // Just below HP (20)
          peq: 100,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      // Adding 10 RF to cross threshold (15 + 10 = 25 > 20)
      const result = applyFatigue(save, "PC_1", 10, catalogs);
      expect(result.actorsById["PC_1"].resources.rf).toBe(25);
      const modifiers = result.actorsById["PC_1"].status.tempModifiers || [];
      expect(modifiers.length).toBe(1);
      expect(modifiers[0]).toEqual({
        id: "fatigue:PC_1",
        scope: "all",
        value: -10,
      });
    });

    it("should upgrade modifier to -20 when crossing RF > 2*HP threshold", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 0,
          rf: 35, // Just below 2*HP (40)
          peq: 100,
        },
        status: {
          conditions: [],
          tempModifiers: [
            {
              id: "fatigue:PC_1",
              scope: "all",
              value: -10,
            },
          ],
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      // Adding 10 RF to cross threshold (35 + 10 = 45 > 40)
      const result = applyFatigue(save, "PC_1", 10, catalogs);
      expect(result.actorsById["PC_1"].resources.rf).toBe(45);
      const modifiers = result.actorsById["PC_1"].status.tempModifiers || [];
      expect(modifiers.length).toBe(1);
      expect(modifiers[0].value).toBe(-20);
    });

    it("should apply unconscious condition when crossing RF >= 2.5*HP threshold", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 0,
          rf: 45, // Just below 2.5*HP (50)
          peq: 100,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      // Adding 10 RF to cross threshold (45 + 10 = 55 >= 50)
      const result = applyFatigue(save, "PC_1", 10, catalogs);
      expect(result.actorsById["PC_1"].resources.rf).toBe(55);
      expect(hasCondition(result.actorsById["PC_1"], "unconscious")).toBe(true);
      const condition = result.actorsById["PC_1"].conditions?.unconscious;
      expect(condition?.source).toBe("fatigue");
    });

    it("should set isDead when RF >= 3*HP", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 0,
          rf: 55, // Just below 3*HP (60)
          peq: 100,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      // Adding 10 RF to cross threshold (55 + 10 = 65 >= 60)
      const result = applyFatigue(save, "PC_1", 10, catalogs);
      expect(result.actorsById["PC_1"].resources.rf).toBe(65);
      expect(result.actorsById["PC_1"].resources.isDead).toBe(true);
      expect(result.actorsById["PC_1"].resources.isDead).not.toBeUndefined();
    });

    it("should remove modifier when RF decreases below HP", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 0,
          rf: 25, // Above HP (20)
          peq: 100,
        },
        status: {
          conditions: [],
          tempModifiers: [
            {
              id: "fatigue:PC_1",
              scope: "all",
              value: -10,
            },
          ],
        },
      });
      const save = makeTestSave(storyPack, actor);

      // Reducing RF by 10 (25 - 10 = 15 <= 20)
      // Note: applyFatigue adds fatigue, so we need to simulate reduction differently
      // Actually, applyFatigue only adds, so we'll test the threshold logic differently
      // Let's test that modifier is removed when RF is already below threshold
      const actorBelowThreshold = {
        ...actor,
        resources: {
          ...actor.resources,
          rf: 15, // Below HP
        },
      };
      const saveBelowThreshold = {
        ...save,
        actorsById: {
          ...save.actorsById,
          ["PC_1"]: actorBelowThreshold,
        },
      };

      // Adding 0 RF should remove modifier if RF <= HP
      const result = applyFatigue(saveBelowThreshold, "PC_1", 0);
      const modifiers = result.actorsById["PC_1"].status.tempModifiers || [];
      expect(modifiers.length).toBe(0);
    });

    it("should maintain -10 modifier when RF is between HP and 2*HP", () => {
      // Test that modifier stays at -10 when RF is in the range (HP, 2*HP]
      // Use catalogs to get correct maxHp calculation (20 instead of default 100)
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 0,
          rf: 15, // Just below HP (20)
          peq: 100,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      // Add RF to cross HP threshold (15 + 10 = 25 > 20), which should add -10 modifier
      const saveWithModifier = applyFatigue(save, "PC_1", 10, catalogs);
      expect(saveWithModifier.actorsById["PC_1"].resources.rf).toBe(25);
      let modifiers = saveWithModifier.actorsById["PC_1"].status.tempModifiers || [];
      expect(modifiers.length).toBe(1);
      expect(modifiers[0].value).toBe(-10);

      // Now add more RF that stays below 2*HP (25 + 5 = 30 < 40)
      const result = applyFatigue(saveWithModifier, "PC_1", 5, catalogs);
      expect(result.actorsById["PC_1"].resources.rf).toBe(30);
      modifiers = result.actorsById["PC_1"].status.tempModifiers || [];
      expect(modifiers.length).toBe(1);
      expect(modifiers[0].value).toBe(-10); // Should remain -10
    });

    it("should remove unconscious condition when RF decreases below 2.5*HP if caused by fatigue", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 0,
          rf: 50, // At 2.5*HP
          peq: 100,
        },
        conditions: {
          unconscious: {
            stacks: 1,
            source: "fatigue",
            untilTurnCounter: 999,
          },
        },
      });
      const save = makeTestSave(storyPack, actor);

      // Reducing RF below 2.5*HP
      const actorBelowThreshold = {
        ...actor,
        resources: {
          ...actor.resources,
          rf: 45,
        },
      };
      const saveBelowThreshold = {
        ...save,
        actorsById: {
          ...save.actorsById,
          ["PC_1"]: actorBelowThreshold,
        },
      };

      const result = applyFatigue(saveBelowThreshold, "PC_1", 0);
      expect(hasCondition(result.actorsById["PC_1"], "unconscious")).toBe(false);
    });

    it("should not remove unconscious condition if not caused by fatigue", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 0,
          rf: 10,
          peq: 100,
        },
        conditions: {
          unconscious: {
            stacks: 1,
            source: "other", // Not from fatigue
            untilTurnCounter: 999,
          },
        },
      });
      const save = makeTestSave(storyPack, actor);

      const result = applyFatigue(save, "PC_1", 0);
      expect(hasCondition(result.actorsById["PC_1"], "unconscious")).toBe(true);
    });

    it("should use catalogs for maxHp calculation when provided", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        resources: {
          wounds: 0,
          rf: 0,
          peq: 100,
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
            tier: 1,
            xpCost: 500,
            prerequisites: [],
            grants: [{ type: "hpMaxFlat", value: 2 }],
            maxRank: 1,
          },
        ],
        traits: [],
      };

      // maxHp = 22, adding 25 RF to cross threshold
      const result = applyFatigue(save, "PC_1", 25, catalogs);
      expect(result.actorsById["PC_1"].resources.rf).toBe(25);
      const modifiers = result.actorsById["PC_1"].status.tempModifiers || [];
      expect(modifiers.length).toBe(1);
      expect(modifiers[0].value).toBe(-10);
    });
  });
});
