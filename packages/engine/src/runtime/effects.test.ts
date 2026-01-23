import { describe, it, expect } from "vitest";
import { applyEffect, applyEffects } from "./effects";
import { makeTestSave } from "./test-helpers/makeTestSave";
import { makeTestStoryPack } from "./test-helpers/makeTestStoryPack";
import { makeTestActor } from "./test-helpers/makeTestActor";
import { FakeRng } from "./test-helpers/fakeRng";
import type { Effect } from "./types";

const makeItem = (id: string, name: string) => ({
  id,
  name,
  type: "wearable" as const,
  weight: 1,
});

describe("effects", () => {
  describe("applyEffect", () => {
    describe("clearChoiceCheckResults", () => {
      it("should remove only failed checks when onlyFailed is true", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const baseSave = makeTestSave(storyPack, actor);
        const rng = new FakeRng([]);

        const save = {
          ...baseSave,
          runtime: {
            ...baseSave.runtime,
            choiceCheckResults: {
              C_SUCCESS: {
                checkId: "CHK_SUCCESS",
                actorId: actor.id,
                roll: 10,
                target: 50,
                success: true,
                dos: 4,
                dof: 0,
                critical: "none",
                tags: [],
              },
              C_FAIL: {
                checkId: "CHK_FAIL",
                actorId: actor.id,
                roll: 90,
                target: 40,
                success: false,
                dos: 0,
                dof: 5,
                critical: "none",
                tags: [],
              },
            },
          },
        };

        const effect: Effect = { op: "clearChoiceCheckResults", onlyFailed: true };
        const result = applyEffect(effect, storyPack, save, rng);

        expect(result.save.runtime.choiceCheckResults?.C_SUCCESS).toBeTruthy();
        expect(result.save.runtime.choiceCheckResults?.C_FAIL).toBeUndefined();
      });
    });
    describe("setFlag", () => {
      it("should set a flag to true", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "setFlag",
          path: "testFlag",
          value: true,
        };

        const result = applyEffect(effect, storyPack, save, rng);
        expect(result.save.state.flags.testFlag).toBe(true);
      });

      it("should set a flag to false", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "setFlag",
          path: "testFlag",
          value: false,
        };

        const result = applyEffect(effect, storyPack, save, rng);
        expect(result.save.state.flags.testFlag).toBe(false);
      });

      it("should handle flags. prefix", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "setFlag",
          path: "flags.testFlag",
          value: true,
        };

        const result = applyEffect(effect, storyPack, save, rng);
        expect(result.save.state.flags.testFlag).toBe(true);
      });

      it("should preserve other flags", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor, 123, 0);
        const saveWithFlags = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, existingFlag: true },
          },
        };
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "setFlag",
          path: "newFlag",
          value: true,
        };

        const result = applyEffect(effect, storyPack, saveWithFlags, rng);
        expect(result.save.state.flags.existingFlag).toBe(true);
        expect(result.save.state.flags.newFlag).toBe(true);
      });
    });

    describe("addCounter", () => {
      it("should add to an existing counter", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const saveWithCounter = {
          ...save,
          state: {
            ...save.state,
            counters: { ...save.state.counters, testCounter: 5 },
          },
        };
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "addCounter",
          path: "testCounter",
          value: 3,
        };

        const result = applyEffect(effect, storyPack, saveWithCounter, rng);
        expect(result.save.state.counters.testCounter).toBe(8);
      });

      it("should create a counter if it doesn't exist", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "addCounter",
          path: "newCounter",
          value: 10,
        };

        const result = applyEffect(effect, storyPack, save, rng);
        expect(result.save.state.counters.newCounter).toBe(10);
      });

      it("should handle negative values", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const saveWithCounter = {
          ...save,
          state: {
            ...save.state,
            counters: { ...save.state.counters, testCounter: 10 },
          },
        };
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "addCounter",
          path: "testCounter",
          value: -5,
        };

        const result = applyEffect(effect, storyPack, saveWithCounter, rng);
        expect(result.save.state.counters.testCounter).toBe(5);
      });

      it("should handle counters. prefix", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "addCounter",
          path: "counters.testCounter",
          value: 5,
        };

        const result = applyEffect(effect, storyPack, save, rng);
        expect(result.save.state.counters.testCounter).toBe(5);
      });
    });

    describe("addItem", () => {
      it("should add an item to actor inventory", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor, 123456, 0);
        // Add item to catalog
        const saveWithCatalog = {
          ...save,
          itemsById: {
            ...save.itemsById,
            item1: makeItem("item1", "Test Item"),
          },
        };
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "addItem",
          actorId: actor.id,
          itemId: "item1",
        };

        const result = applyEffect(effect, storyPack, saveWithCatalog, rng);
        const updatedActor = result.save.actorsById[actor.id];
        expect(updatedActor.inventory).toBeDefined();
        expect(updatedActor.inventory?.some((item) => item.id === "item1")).toBe(true);
      });

      it("should add multiple items when applied multiple times", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        // Add items to catalog
        const saveWithCatalog = {
          ...save,
          itemsById: {
            ...save.itemsById,
            item1: makeItem("item1", "Test Item 1"),
            item2: makeItem("item2", "Test Item 2"),
          },
        };
        const rng = new FakeRng([]);

        const effect1: Effect = {
          op: "addItem",
          actorId: actor.id,
          itemId: "item1",
        };
        const effect2: Effect = {
          op: "addItem",
          actorId: actor.id,
          itemId: "item2",
        };

        const result1 = applyEffect(effect1, storyPack, saveWithCatalog, rng);
        const result2 = applyEffect(effect2, storyPack, result1.save, rng);
        const updatedActor = result2.save.actorsById[actor.id];
        expect(updatedActor.inventory?.some((item) => item.id === "item1")).toBe(true);
        expect(updatedActor.inventory?.some((item) => item.id === "item2")).toBe(true);
      });

      it("should preserve existing items", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor({
          inventory: [{ kind: "item", id: "existingItem" }],
        });
        const save = makeTestSave(storyPack, actor);
        // Add items to catalog
        const saveWithCatalog = {
          ...save,
          itemsById: {
            ...save.itemsById,
            existingItem: makeItem("existingItem", "Existing Item"),
            newItem: makeItem("newItem", "New Item"),
          },
        };
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "addItem",
          actorId: actor.id,
          itemId: "newItem",
        };

        const result = applyEffect(effect, storyPack, saveWithCatalog, rng);
        const updatedActor = result.save.actorsById[actor.id];
        expect(updatedActor.inventory?.some((item) => item.id === "existingItem")).toBe(true);
        expect(updatedActor.inventory?.some((item) => item.id === "newItem")).toBe(true);
      });
    });

    describe("removeItem", () => {
      it("should remove an item from actor inventory", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor({
          inventory: [
            { kind: "weapon", id: "item1" },
            { kind: "armor", id: "item2" },
          ],
        });
        const save = makeTestSave(storyPack, actor);
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "removeItem",
          actorId: actor.id,
          itemId: "item1",
        };

        const result = applyEffect(effect, storyPack, save, rng);
        const updatedActor = result.save.actorsById[actor.id];
        expect(updatedActor.inventory?.some((item) => item.id === "item1")).toBe(false);
        expect(updatedActor.inventory?.some((item) => item.id === "item2")).toBe(true);
      });

      it("should handle removing non-existent item gracefully", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor({
          inventory: [{ kind: "weapon", id: "existingItem" }],
        });
        const save = makeTestSave(storyPack, actor);
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "removeItem",
          actorId: actor.id,
          itemId: "nonExistentItem",
        };

        const result = applyEffect(effect, storyPack, save, rng);
        const updatedActor = result.save.actorsById[actor.id];
        // Should still have existing item
        expect(updatedActor.inventory?.some((item) => item.id === "existingItem")).toBe(true);
        expect(updatedActor.inventory?.some((item) => item.id === "nonExistentItem")).toBe(false);
      });
    });

    describe("goto", () => {
      it("should change the current scene", () => {
        const storyPack = makeTestStoryPack({
          scenes: [
            {
              id: "scene1",
              type: "narration",
              title: "Scene 1",
              text: ["Scene 1 text"],
              choices: [],
            },
            {
              id: "scene2",
              type: "narration",
              title: "Scene 2",
              text: ["Scene 2 text"],
              choices: [],
            },
          ],
        });
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "goto",
          sceneId: "scene2",
        };

        const result = applyEffect(effect, storyPack, save, rng);
        expect(result.save.runtime.currentSceneId).toBe("scene2");
      });

      it("should add scene to visited scenes if not already visited", () => {
        const storyPack = makeTestStoryPack({
          scenes: [
            {
              id: "scene1",
              type: "narration",
              title: "Scene 1",
              text: ["Scene 1 text"],
              choices: [],
            },
            {
              id: "scene2",
              type: "narration",
              title: "Scene 2",
              text: ["Scene 2 text"],
              choices: [],
            },
          ],
        });
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "goto",
          sceneId: "scene2",
        };

        const result = applyEffect(effect, storyPack, save, rng);
        expect(result.save.runtime.history.visitedScenes).toContain("scene2");
      });

      it("should not duplicate scene in visited scenes if already visited", () => {
        const storyPack = makeTestStoryPack({
          scenes: [
            {
              id: "scene1",
              type: "narration",
              title: "Scene 1",
              text: ["Scene 1 text"],
              choices: [],
            },
            {
              id: "scene2",
              type: "narration",
              title: "Scene 2",
              text: ["Scene 2 text"],
              choices: [],
            },
          ],
        });
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const saveWithVisited = {
          ...save,
          runtime: {
            ...save.runtime,
            history: {
              ...save.runtime.history,
              visitedScenes: [...save.runtime.history.visitedScenes, "scene2"],
            },
          },
        };
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "goto",
          sceneId: "scene2",
        };

        const result = applyEffect(effect, storyPack, saveWithVisited, rng);
        const scene2Count = result.save.runtime.history.visitedScenes.filter((s) => s === "scene2").length;
        expect(scene2Count).toBe(1);
      });

      it("should clear lastCheck when changing scenes", () => {
        const storyPack = makeTestStoryPack({
          scenes: [
            {
              id: "scene1",
              type: "narration",
              title: "Scene 1",
              text: ["Scene 1 text"],
              choices: [],
            },
            {
              id: "scene2",
              type: "narration",
              title: "Scene 2",
              text: ["Scene 2 text"],
              choices: [],
            },
          ],
        });
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const saveWithCheck = {
          ...save,
          runtime: {
            ...save.runtime,
            lastCheck: {
              checkId: "test",
              actorId: actor.id,
              roll: 50,
              target: 50,
              success: true,
              dos: 0,
              dof: 0,
              critical: "none" as const,
              tags: [],
            },
          },
        };
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "goto",
          sceneId: "scene2",
        };

        const result = applyEffect(effect, storyPack, saveWithCheck, rng);
        expect(result.save.runtime.lastCheck).toBeUndefined();
      });
    });

    describe("conditionalEffects", () => {
      it("should emit effects when condition is true", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const saveWithFlag = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, testFlag: true },
          },
        };
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "conditionalEffects",
          cases: [
            {
              when: { op: "flag", path: "testFlag", value: true },
              then: [{ op: "setFlag", path: "resultFlag", value: true }],
            },
          ],
        };

        const result = applyEffect(effect, storyPack, saveWithFlag, rng);
        expect(result.emittedEffects).toEqual([{ op: "setFlag", path: "resultFlag", value: true }]);
      });

      it("should not emit effects when condition is false", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "conditionalEffects",
          cases: [
            {
              when: { op: "flag", path: "testFlag", value: true },
              then: [{ op: "setFlag", path: "resultFlag", value: true }],
            },
          ],
        };

        const result = applyEffect(effect, storyPack, save, rng);
        expect(result.emittedEffects).toBeUndefined();
      });

      it("should use first matching case", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const saveWithFlag = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, flag1: true, flag2: true },
          },
        };
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "conditionalEffects",
          cases: [
            {
              when: { op: "flag", path: "flag1", value: true },
              then: [{ op: "setFlag", path: "result1", value: true }],
            },
            {
              when: { op: "flag", path: "flag2", value: true },
              then: [{ op: "setFlag", path: "result2", value: true }],
            },
          ],
        };

        const result = applyEffect(effect, storyPack, saveWithFlag, rng);
        expect(result.emittedEffects).toEqual([{ op: "setFlag", path: "result1", value: true }]);
      });
    });

    describe("chooseRunVariant", () => {
      it("should select default variant when strategy is defaultOnly", () => {
        const storyPack = makeTestStoryPack({
          systems: {
            checks: {
              difficultyBands: { Challenging: 0 },
              criticals: {
                autoSuccess: [1, 2, 3],
                autoFail: [98, 99, 100],
              },
            },
            runVariants: [
              { id: "VAR_DEFAULT", tags: ["default"] },
              { id: "VAR_OTHER", tags: ["other"] },
            ],
          },
        });
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        const rng = new FakeRng([]);

        const effect: Effect = {
          op: "chooseRunVariant",
          source: "test",
          strategy: "defaultOnly",
        };

        const result = applyEffect(effect, storyPack, save, rng);
        expect(result.save.state.runVariant?.id).toBe("VAR_DEFAULT");
        expect(result.save.state.runVariant?.tags).toEqual(["default"]);
      });

      it("should select random variant when strategy is random", () => {
        const storyPack = makeTestStoryPack({
          systems: {
            checks: {
              difficultyBands: { Challenging: 0 },
              criticals: {
                autoSuccess: [1, 2, 3],
                autoFail: [98, 99, 100],
              },
            },
            runVariants: [
              { id: "VAR_1", tags: ["tag1"] },
              { id: "VAR_2", tags: ["tag2"] },
            ],
          },
        });
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);
        // Use a deterministic RNG that will select index 0
        const rng = new FakeRng([1]); // Will be used for nextInt

        const effect: Effect = {
          op: "chooseRunVariant",
          source: "test",
          strategy: "random",
        };

        const result = applyEffect(effect, storyPack, save, rng);
        expect(result.save.state.runVariant).toBeDefined();
        expect(["VAR_1", "VAR_2"]).toContain(result.save.state.runVariant?.id);
      });
    });
  });

  describe("addItem", () => {
    it("should block adding items when over carry capacity", () => {
      const storyPack = makeTestStoryPack({
        items: [{ id: "item:rock", name: "Rock", type: "wearable", weight: 20 }],
      });
      const actor = makeTestActor({
        stats: { STR: 40, TOU: 60, AGI: 0, INT: 0, WIL: 0, CHA: 0, WS: 0, BS: 0, INI: 0, PER: 0 },
      });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([]);

      const effect: Effect = {
        op: "addItem",
        actorId: actor.id,
        itemId: "item:rock",
        qty: 4,
      };

      const result = applyEffect(effect, storyPack, save, rng);
      expect(result.save.actorsById[actor.id].inventory || []).toHaveLength(0);
    });

    it("should allow adding items within carry capacity", () => {
      const storyPack = makeTestStoryPack({
        items: [{ id: "item:rock", name: "Rock", type: "wearable", weight: 20 }],
      });
      const actor = makeTestActor({
        stats: { STR: 40, TOU: 60, AGI: 0, INT: 0, WIL: 0, CHA: 0, WS: 0, BS: 0, INI: 0, PER: 0 },
      });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([]);

      const effect: Effect = {
        op: "addItem",
        actorId: actor.id,
        itemId: "item:rock",
        qty: 3,
      };

      const result = applyEffect(effect, storyPack, save, rng);
      expect(result.save.actorsById[actor.id].inventory || []).toHaveLength(3);
    });
  });

  describe("applyEffects", () => {
    it("should apply multiple effects in sequence", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([]);

      const effects: Effect[] = [
        { op: "setFlag", path: "flag1", value: true },
        { op: "setFlag", path: "flag2", value: true },
        { op: "addCounter", path: "counter1", value: 5 },
      ];

      const result = applyEffects(effects, storyPack, save, rng);
      expect(result.state.flags.flag1).toBe(true);
      expect(result.state.flags.flag2).toBe(true);
      expect(result.state.counters.counter1).toBe(5);
    });

    it("should process emitted effects from conditionalEffects", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);
      const saveWithFlag = {
        ...save,
        state: {
          ...save.state,
          flags: { ...save.state.flags, testFlag: true },
        },
      };
      const rng = new FakeRng([]);

      const effects: Effect[] = [
        {
          op: "conditionalEffects",
          cases: [
            {
              when: { op: "flag", path: "testFlag", value: true },
              then: [{ op: "setFlag", path: "resultFlag", value: true }],
            },
          ],
        },
      ];

      const result = applyEffects(effects, storyPack, saveWithFlag, rng);
      expect(result.state.flags.resultFlag).toBe(true);
    });

    it("should process nested emitted effects", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);
      const saveWithFlag = {
        ...save,
        state: {
          ...save.state,
          flags: { ...save.state.flags, flag1: true },
        },
      };
      const rng = new FakeRng([]);

      const effects: Effect[] = [
        {
          op: "conditionalEffects",
          cases: [
            {
              when: { op: "flag", path: "flag1", value: true },
              then: [
                {
                  op: "conditionalEffects",
                  cases: [
                    {
                      when: { op: "flag", path: "flag1", value: true },
                      then: [{ op: "setFlag", path: "finalFlag", value: true }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ];

      const result = applyEffects(effects, storyPack, saveWithFlag, rng);
      expect(result.state.flags.finalFlag).toBe(true);
    });
  });
});

