import { describe, it, expect } from "vitest";
import { evaluatePrerequisites } from "./prerequisites";
import { makeTestActor } from "../test-helpers/makeTestActor";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";

describe("talent prerequisites and armor AGI cap", () => {
  it("uses raw stats (not armor-capped AGI) for prerequisites", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({
      stats: { AGI: 80 } as any,
      equipment: { armor: { kind: "armor", id: "plate" } },
    });
    const save = makeTestSave(storyPack, actor);
    const saveWithArmor = {
      ...save,
      armorsById: {
        plate: {
          id: "plate",
          name: "Plate",
          soak: 4,
          agiMax: 50,
          weight: 10,
        },
      },
    };

    const catalogs = { skills: [], talents: [], traits: [] };
    const result = evaluatePrerequisites(saveWithArmor, catalogs, actor, [
      { type: "statAtLeast", stat: "AGI", value: 70 },
    ]);
    expect(result.valid).toBe(true);
  });
});
import { describe, it, expect } from "vitest";
import {
  evaluatePrerequisites,
  hasTrait,
  hasTalentRank,
  statAtLeast,
} from "./prerequisites";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import type { CharacterCatalogs, Prerequisite } from "../../content/catalogs";

describe("prerequisites", () => {
  const storyPack = makeTestStoryPack();

  describe("evaluatePrerequisites", () => {
    it("should return valid: true for empty prerequisites", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const result = evaluatePrerequisites(save, catalogs, actor, []);
      expect(result.valid).toBe(true);
    });

    it("should validate statAtLeast prerequisite", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [{ type: "statAtLeast", stat: "STR", value: 40 }];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should fail statAtLeast when stat is too low", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 30,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [{ type: "statAtLeast", stat: "STR", value: 40 }];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Requires STR >= 40");
    });

    it("should validate hasTalent prerequisite", () => {
      const actor = makeTestActor({
        id: "PC_1",
        talents: {
          "talent:test": 1,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [{ type: "hasTalent", talentId: "talent:test" }];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs);
      expect(result.valid).toBe(true);
    });

    it("should fail hasTalent when talent not present", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [{ type: "hasTalent", talentId: "talent:test" }];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Requires talent talent:test");
    });

    it("should fail hasTalent when talent rank is 0", () => {
      const actor = makeTestActor({
        id: "PC_1",
        talents: {
          "talent:test": 0,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [{ type: "hasTalent", talentId: "talent:test" }];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs);
      expect(result.valid).toBe(false);
    });

    it("should validate hasTrait prerequisite", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:test": {},
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [{ type: "hasTrait", traitId: "trait:test" }];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs);
      expect(result.valid).toBe(true);
    });

    it("should fail hasTrait when trait not present", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [{ type: "hasTrait", traitId: "trait:test" }];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Requires trait trait:test");
    });

    it("should validate hasSpell prerequisite", () => {
      const actor = makeTestActor({
        id: "PC_1",
        spells: {
          "spell:test": true,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [{ type: "hasSpell", spellId: "spell:test" }];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs);
      expect(result.valid).toBe(true);
    });

    it("should fail hasSpell when spell not present", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [{ type: "hasSpell", spellId: "spell:test" }];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Requires spell spell:test");
    });

    it("should validate hasSkillRank prerequisite", () => {
      const actor = makeTestActor({
        id: "PC_1",
        skills: {
          "skill:medicae": 4,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [{ type: "hasSkillRank", skillId: "skill:medicae", minRank: 4 }];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs);
      expect(result.valid).toBe(true);
    });

    it("should resolve skillId from chosen params for hasSkillRank", () => {
      const actor = makeTestActor({
        id: "PC_1",
        skills: {
          "skill:medicae": 4,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [{ type: "hasSkillRank", skillId: "<chosenSkill>", minRank: 4 }];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs, { chosenSkill: "skill:medicae" });
      expect(result.valid).toBe(true);
    });

    it("should validate multiple prerequisites (all must pass)", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
        },
        talents: {
          "talent:test": 1,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [
        { type: "statAtLeast", stat: "STR", value: 40 },
        { type: "hasTalent", talentId: "talent:test" },
      ];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs);
      expect(result.valid).toBe(true);
    });

    it("should fail when any prerequisite fails", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 30, // Too low
        },
        talents: {
          "talent:test": 1,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const prereqs: Prerequisite[] = [
        { type: "statAtLeast", stat: "STR", value: 40 },
        { type: "hasTalent", talentId: "talent:test" },
      ];
      const result = evaluatePrerequisites(save, catalogs, actor, prereqs);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("STR >= 40");
    });
  });

  describe("hasTrait", () => {
    it("should return true when trait exists", () => {
      const actor = makeTestActor({
        traits: {
          "trait:test": {},
        },
      });
      expect(hasTrait(actor, "trait:test")).toBe(true);
    });

    it("should return false when trait does not exist", () => {
      const actor = makeTestActor({
        traits: {},
      });
      expect(hasTrait(actor, "trait:test")).toBe(false);
    });
  });

  describe("hasTalentRank", () => {
    it("should return true when talent rank meets minimum", () => {
      const actor = makeTestActor({
        talents: {
          "talent:test": 3,
        },
      });
      expect(hasTalentRank(actor, "talent:test", 2)).toBe(true);
      expect(hasTalentRank(actor, "talent:test", 3)).toBe(true);
    });

    it("should return false when talent rank is too low", () => {
      const actor = makeTestActor({
        talents: {
          "talent:test": 2,
        },
      });
      expect(hasTalentRank(actor, "talent:test", 3)).toBe(false);
    });

    it("should default to minRank 1", () => {
      const actor = makeTestActor({
        talents: {
          "talent:test": 1,
        },
      });
      expect(hasTalentRank(actor, "talent:test")).toBe(true);
    });

    it("should return false when talent does not exist", () => {
      const actor = makeTestActor({
        talents: {},
      });
      expect(hasTalentRank(actor, "talent:test")).toBe(false);
    });
  });

  describe("statAtLeast", () => {
    it("should return true when stat meets minimum", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
        },
      });
      const save = makeTestSave(storyPack, actor);

      expect(statAtLeast(save, actor, "STR", 40)).toBe(true);
      expect(statAtLeast(save, actor, "STR", 50)).toBe(true);
    });

    it("should return false when stat is too low", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 30,
        },
      });
      const save = makeTestSave(storyPack, actor);

      expect(statAtLeast(save, actor, "STR", 40)).toBe(false);
    });
  });
});
