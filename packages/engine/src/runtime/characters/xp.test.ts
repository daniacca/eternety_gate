import { describe, it, expect } from "vitest";
import { getActorXp, grantActorXp, spendActorXp, buyTalent } from "./xp";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import type { CharacterCatalogs } from "../../content/catalogs";

describe("xp", () => {
  const storyPack = makeTestStoryPack();

  describe("getActorXp", () => {
    it("should return 0 when XP is undefined", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      expect(getActorXp(save, "PC_1")).toBe(0);
    });

    it("should return XP value from actor resources", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const saveWithXp = {
        ...save,
        actorsById: {
          ...save.actorsById,
          PC_1: {
            ...save.actorsById.PC_1,
            resources: {
              ...save.actorsById.PC_1.resources,
              xp: 1000,
            },
          },
        },
      };
      expect(getActorXp(saveWithXp, "PC_1")).toBe(1000);
    });
  });

  describe("grantActorXp", () => {
    it("should add XP to existing amount", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const saveWithXp = {
        ...save,
        actorsById: {
          ...save.actorsById,
          PC_1: {
            ...save.actorsById.PC_1,
            resources: {
              ...save.actorsById.PC_1.resources,
              xp: 500,
            },
          },
        },
      };

      const updated = grantActorXp(saveWithXp, "PC_1", 300);
      expect(getActorXp(updated, "PC_1")).toBe(800);
    });

    it("should add XP when starting from 0", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);

      const updated = grantActorXp(save, "PC_1", 1000);
      expect(getActorXp(updated, "PC_1")).toBe(1000);
    });
  });

  describe("spendActorXp", () => {
    it("should spend XP when sufficient", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const saveWithXp = {
        ...save,
        actorsById: {
          ...save.actorsById,
          PC_1: {
            ...save.actorsById.PC_1,
            resources: {
              ...save.actorsById.PC_1.resources,
              xp: 1000,
            },
          },
        },
      };

      const result = spendActorXp(saveWithXp, "PC_1", 500);
      expect(result.error).toBeUndefined();
      expect(getActorXp(result.save, "PC_1")).toBe(500);
    });

    it("should return error when insufficient XP", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const saveWithXp = {
        ...save,
        actorsById: {
          ...save.actorsById,
          PC_1: {
            ...save.actorsById.PC_1,
            resources: {
              ...save.actorsById.PC_1.resources,
              xp: 300,
            },
          },
        },
      };

      const result = spendActorXp(saveWithXp, "PC_1", 500);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Insufficient XP");
      expect(result.error).toContain("Required: 500");
      expect(result.error).toContain("Available: 300");
      expect(getActorXp(result.save, "PC_1")).toBe(300); // Unchanged
    });
  });

  describe("buyTalent", () => {
    const createCatalogsWithTalent = (): CharacterCatalogs => ({
      skills: [],
      talents: [
        {
          id: "talent:test",
          name: "Test Talent",
          tier: 1,
          xpCost: 500,
          prerequisites: [],
          maxRank: 3,
          grants: [],
        },
      ],
      traits: [],
    });

    it("should return error when actor not found", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithTalent();

      const result = buyTalent(save, catalogs, "NPC_1", "talent:test");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Actor NPC_1 not found");
    });

    it("should return error when talent not found", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      const result = buyTalent(save, catalogs, "PC_1", "talent:test");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Talent talent:test not found");
    });

    it("should return error when talent already at max rank", () => {
      const actor = makeTestActor({
        id: "PC_1",
        talents: {
          "talent:test": 3,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithTalent();

      const result = buyTalent(save, catalogs, "PC_1", "talent:test");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("already at max rank");
    });

    it("should return error when prerequisites not met", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 30, // Too low
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [
          {
            id: "talent:test",
            name: "Test Talent",
            tier: 1,
            xpCost: 500,
            prerequisites: [{ type: "statAtLeast", stat: "STR", value: 40 }],
            maxRank: 1,
            grants: [],
          },
        ],
        traits: [],
      };

      // Give actor enough XP (per-actor XP in actor.resources.xp)
      const saveWithXp = {
        ...save,
        actorsById: {
          ...save.actorsById,
          PC_1: {
            ...save.actorsById.PC_1,
            resources: {
              ...save.actorsById.PC_1.resources,
              xp: 1000,
            },
          },
        },
      };

      const result = buyTalent(saveWithXp, catalogs, "PC_1", "talent:test");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Requires STR >= 40");
    });

    it("should return error when insufficient XP", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithTalent();

      // Per-actor XP in actor.resources.xp
      const saveWithXp = {
        ...save,
        actorsById: {
          ...save.actorsById,
          PC_1: {
            ...save.actorsById.PC_1,
            resources: {
              ...save.actorsById.PC_1.resources,
              xp: 300, // Less than 500
            },
          },
        },
      };

      const result = buyTalent(saveWithXp, catalogs, "PC_1", "talent:test");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Insufficient XP");
    });

    it("should successfully buy talent rank 1", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithTalent();

      // Per-actor XP in actor.resources.xp
      const saveWithXp = {
        ...save,
        actorsById: {
          ...save.actorsById,
          PC_1: {
            ...save.actorsById.PC_1,
            resources: {
              ...save.actorsById.PC_1.resources,
              xp: 1000,
            },
          },
        },
      };

      const result = buyTalent(saveWithXp, catalogs, "PC_1", "talent:test");
      expect(result.error).toBeUndefined();
      expect(getActorXp(result.save, "PC_1")).toBe(500); // XP spent
      expect(result.save.actorsById["PC_1"].talents["talent:test"]).toBe(1);
    });

    it("should increment existing talent rank", () => {
      const actor = makeTestActor({
        id: "PC_1",
        talents: {
          "talent:test": 1,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithTalent();

      // Per-actor XP in actor.resources.xp
      const saveWithXp = {
        ...save,
        actorsById: {
          ...save.actorsById,
          PC_1: {
            ...save.actorsById.PC_1,
            resources: {
              ...save.actorsById.PC_1.resources,
              xp: 1000,
            },
          },
        },
      };

      const result = buyTalent(saveWithXp, catalogs, "PC_1", "talent:test");
      expect(result.error).toBeUndefined();
      expect(result.save.actorsById["PC_1"].talents["talent:test"]).toBe(2);
    });
  });
});
