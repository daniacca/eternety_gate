import { describe, it, expect } from "vitest";
import { processRegeneration } from "./regeneration";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import { FakeRng } from "../test-helpers/fakeRng";
import type { CharacterCatalogs } from "../../content/catalogs";

describe("regeneration", () => {
  const storyPack = makeTestStoryPack();

  const createCatalogs: () => CharacterCatalogs = () => ({
    skills: [],
    talents: [],
    traits: [],
  });

  describe("processRegeneration", () => {
    it("should return unchanged save when actor not found", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogs();
      const rng = new FakeRng([50]); // Pass TOU check

      const result = processRegeneration(save, catalogs, storyPack, "NPC_1", rng);
      expect(result).toBe(save);
    });

    it("should return unchanged save when actor does not have regeneration trait", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {},
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogs();
      const rng = new FakeRng([50]);

      const result = processRegeneration(save, catalogs, storyPack, "PC_1", rng);
      expect(result).toBe(save);
    });

    it("should return unchanged save when regeneration trait has invalid structure", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:regeneration": "invalid" as any,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogs();
      const rng = new FakeRng([50]);

      const result = processRegeneration(save, catalogs, storyPack, "PC_1", rng);
      expect(result).toBe(save);
    });

    it("should return unchanged save when TOU check fails", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          TOU: 30, // Low TOU
        },
        traits: {
          "trait:regeneration": {
            x: 5,
          },
        },
        resources: {
          wounds: 10,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogs();
      const rng = new FakeRng([95]); // Fail TOU check (high roll)

      const result = processRegeneration(save, catalogs, storyPack, "PC_1", rng);
      expect(result).toBe(save);
    });

    it("should heal wounds when TOU check succeeds", () => {
      const actor = makeTestActor({
        id: "PC_1",
        name: "Test Actor",
        stats: {
          STR: 50,
          TOU: 50, // bonus = 5, target = 55
          WIL: 50,
        },
        traits: {
          "trait:regeneration": {
            x: 5,
          },
        },
        resources: {
          wounds: 10,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogs();
      const rng = new FakeRng([10]); // Pass TOU check (roll 10, target 55)

      const result = processRegeneration(save, catalogs, storyPack, "PC_1", rng);
      expect(result.actorsById["PC_1"].resources.wounds).toBe(5); // 10 - 5 = 5
    });

    it("should not heal below 0 wounds", () => {
      const actor = makeTestActor({
        id: "PC_1",
        name: "Test Actor",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        traits: {
          "trait:regeneration": {
            x: 15, // More than wounds
          },
        },
        resources: {
          wounds: 10,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogs();
      const rng = new FakeRng([10]);

      const result = processRegeneration(save, catalogs, storyPack, "PC_1", rng);
      expect(result.actorsById["PC_1"].resources.wounds).toBe(0);
    });

    it("should return unchanged save when already at max HP (no wounds)", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        traits: {
          "trait:regeneration": {
            x: 5,
          },
        },
        resources: {
          wounds: 0,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogs();
      const rng = new FakeRng([10]);

      const result = processRegeneration(save, catalogs, storyPack, "PC_1", rng);
      expect(result).toBe(save);
    });

    it("should log regeneration message", () => {
      const actor = makeTestActor({
        id: "PC_1",
        name: "Test Actor",
        stats: {
          STR: 50,
          TOU: 50,
          WIL: 50,
        },
        traits: {
          "trait:regeneration": {
            x: 5,
          },
        },
        resources: {
          wounds: 10,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogs();
      const rng = new FakeRng([10]);

      const result = processRegeneration(save, catalogs, storyPack, "PC_1", rng);
      const runtimeLog = result.runtime.runtimeLog || [];
      const regenLog = runtimeLog.find((log) => log.kind === "system");
      expect(regenLog).toBeDefined();
      expect((regenLog as any).message).toContain("rigenera");
    });
  });
});
