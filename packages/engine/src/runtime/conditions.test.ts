import { describe, it, expect } from "vitest";
import { evaluateCondition, evaluateConditions } from "./conditions";
import { makeTestSave } from "./test-helpers/makeTestSave";
import { makeTestStoryPack } from "./test-helpers/makeTestStoryPack";
import { makeTestActor } from "./test-helpers/makeTestActor";
import type { Condition } from "./types";

describe("conditions", () => {
  describe("evaluateCondition", () => {
    describe("flag conditions", () => {
      it("should evaluate flag condition correctly when flag matches", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "flag",
          path: "testFlag",
          value: true,
        };

        const saveWithFlag = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, testFlag: true },
          },
        };

        expect(evaluateCondition(condition, saveWithFlag)).toBe(true);
      });

      it("should evaluate flag condition correctly when flag does not match", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "flag",
          path: "testFlag",
          value: true,
        };

        const saveWithFlag = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, testFlag: false },
          },
        };

        expect(evaluateCondition(condition, saveWithFlag)).toBe(false);
      });

      it("should handle flags. prefix correctly", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "flag",
          path: "flags.testFlag",
          value: true,
        };

        const saveWithFlag = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, testFlag: true },
          },
        };

        expect(evaluateCondition(condition, saveWithFlag)).toBe(true);
      });

      it("should return false for undefined flags", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "flag",
          path: "undefinedFlag",
          value: true,
        };

        expect(evaluateCondition(condition, save)).toBe(false);
      });
    });

    describe("counterGte conditions", () => {
      it("should evaluate counterGte correctly when counter >= value", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "counterGte",
          path: "testCounter",
          value: 5,
        };

        const saveWithCounter = {
          ...save,
          state: {
            ...save.state,
            counters: { ...save.state.counters, testCounter: 10 },
          },
        };

        expect(evaluateCondition(condition, saveWithCounter)).toBe(true);
      });

      it("should evaluate counterGte correctly when counter equals value", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "counterGte",
          path: "testCounter",
          value: 5,
        };

        const saveWithCounter = {
          ...save,
          state: {
            ...save.state,
            counters: { ...save.state.counters, testCounter: 5 },
          },
        };

        expect(evaluateCondition(condition, saveWithCounter)).toBe(true);
      });

      it("should evaluate counterGte correctly when counter < value", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "counterGte",
          path: "testCounter",
          value: 5,
        };

        const saveWithCounter = {
          ...save,
          state: {
            ...save.state,
            counters: { ...save.state.counters, testCounter: 3 },
          },
        };

        expect(evaluateCondition(condition, saveWithCounter)).toBe(false);
      });

      it("should handle counters. prefix correctly", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "counterGte",
          path: "counters.testCounter",
          value: 5,
        };

        const saveWithCounter = {
          ...save,
          state: {
            ...save.state,
            counters: { ...save.state.counters, testCounter: 10 },
          },
        };

        expect(evaluateCondition(condition, saveWithCounter)).toBe(true);
      });

      it("should return false for undefined counters", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "counterGte",
          path: "undefinedCounter",
          value: 5,
        };

        expect(evaluateCondition(condition, save)).toBe(false);
      });
    });

    describe("counterLte conditions", () => {
      it("should evaluate counterLte correctly when counter <= value", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "counterLte",
          path: "testCounter",
          value: 10,
        };

        const saveWithCounter = {
          ...save,
          state: {
            ...save.state,
            counters: { ...save.state.counters, testCounter: 5 },
          },
        };

        expect(evaluateCondition(condition, saveWithCounter)).toBe(true);
      });

      it("should evaluate counterLte correctly when counter equals value", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "counterLte",
          path: "testCounter",
          value: 10,
        };

        const saveWithCounter = {
          ...save,
          state: {
            ...save.state,
            counters: { ...save.state.counters, testCounter: 10 },
          },
        };

        expect(evaluateCondition(condition, saveWithCounter)).toBe(true);
      });

      it("should evaluate counterLte correctly when counter > value", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "counterLte",
          path: "testCounter",
          value: 10,
        };

        const saveWithCounter = {
          ...save,
          state: {
            ...save.state,
            counters: { ...save.state.counters, testCounter: 15 },
          },
        };

        expect(evaluateCondition(condition, saveWithCounter)).toBe(false);
      });
    });

    describe("and conditions", () => {
      it("should evaluate and condition correctly when all clauses are true", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "and",
          clauses: [
            { op: "flag", path: "flag1", value: true },
            { op: "flag", path: "flag2", value: true },
          ],
        };

        const saveWithFlags = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, flag1: true, flag2: true },
          },
        };

        expect(evaluateCondition(condition, saveWithFlags)).toBe(true);
      });

      it("should evaluate and condition correctly when one clause is false", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "and",
          clauses: [
            { op: "flag", path: "flag1", value: true },
            { op: "flag", path: "flag2", value: true },
          ],
        };

        const saveWithFlags = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, flag1: true, flag2: false },
          },
        };

        expect(evaluateCondition(condition, saveWithFlags)).toBe(false);
      });

      it("should evaluate and condition correctly when all clauses are false", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "and",
          clauses: [
            { op: "flag", path: "flag1", value: true },
            { op: "flag", path: "flag2", value: true },
          ],
        };

        const saveWithFlags = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, flag1: false, flag2: false },
          },
        };

        expect(evaluateCondition(condition, saveWithFlags)).toBe(false);
      });

      it("should handle nested and conditions", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "and",
          clauses: [
            { op: "flag", path: "flag1", value: true },
            {
              op: "and",
              clauses: [
                { op: "flag", path: "flag2", value: true },
                { op: "flag", path: "flag3", value: true },
              ],
            },
          ],
        };

        const saveWithFlags = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, flag1: true, flag2: true, flag3: true },
          },
        };

        expect(evaluateCondition(condition, saveWithFlags)).toBe(true);
      });
    });

    describe("or conditions", () => {
      it("should evaluate or condition correctly when one clause is true", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "or",
          clauses: [
            { op: "flag", path: "flag1", value: true },
            { op: "flag", path: "flag2", value: true },
          ],
        };

        const saveWithFlags = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, flag1: true, flag2: false },
          },
        };

        expect(evaluateCondition(condition, saveWithFlags)).toBe(true);
      });

      it("should evaluate or condition correctly when all clauses are true", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "or",
          clauses: [
            { op: "flag", path: "flag1", value: true },
            { op: "flag", path: "flag2", value: true },
          ],
        };

        const saveWithFlags = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, flag1: true, flag2: true },
          },
        };

        expect(evaluateCondition(condition, saveWithFlags)).toBe(true);
      });

      it("should evaluate or condition correctly when all clauses are false", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "or",
          clauses: [
            { op: "flag", path: "flag1", value: true },
            { op: "flag", path: "flag2", value: true },
          ],
        };

        const saveWithFlags = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, flag1: false, flag2: false },
          },
        };

        expect(evaluateCondition(condition, saveWithFlags)).toBe(false);
      });
    });

    describe("not conditions", () => {
      it("should evaluate not condition correctly when clause is false", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "not",
          clause: { op: "flag", path: "testFlag", value: true },
        };

        const saveWithFlag = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, testFlag: false },
          },
        };

        expect(evaluateCondition(condition, saveWithFlag)).toBe(true);
      });

      it("should evaluate not condition correctly when clause is true", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "not",
          clause: { op: "flag", path: "testFlag", value: true },
        };

        const saveWithFlag = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, testFlag: true },
          },
        };

        expect(evaluateCondition(condition, saveWithFlag)).toBe(false);
      });

      it("should handle nested not conditions", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "not",
          clause: {
            op: "not",
            clause: { op: "flag", path: "testFlag", value: true },
          },
        };

        const saveWithFlag = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, testFlag: true },
          },
        };

        expect(evaluateCondition(condition, saveWithFlag)).toBe(true);
      });
    });

    describe("complex nested conditions", () => {
      it("should handle complex nested conditions correctly", () => {
        const storyPack = makeTestStoryPack();
        const actor = makeTestActor();
        const save = makeTestSave(storyPack, actor);

        const condition: Condition = {
          op: "and",
          clauses: [
            { op: "flag", path: "flag1", value: true },
            {
              op: "or",
              clauses: [
                { op: "counterGte", path: "counter1", value: 5 },
                { op: "not", clause: { op: "flag", path: "flag2", value: true } },
              ],
            },
          ],
        };

        const saveWithState = {
          ...save,
          state: {
            ...save.state,
            flags: { ...save.state.flags, flag1: true, flag2: false },
            counters: { ...save.state.counters, counter1: 3 },
          },
        };

        // flag1=true AND (counter1>=5 OR flag2=false)
        // = true AND (false OR true)
        // = true AND true
        // = true
        expect(evaluateCondition(condition, saveWithState)).toBe(true);
      });
    });
  });

  describe("evaluateConditions", () => {
    it("should evaluate single condition", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);

      const condition: Condition = {
        op: "flag",
        path: "testFlag",
        value: true,
      };

      const saveWithFlag = {
        ...save,
        state: {
          ...save.state,
          flags: { ...save.state.flags, testFlag: true },
        },
      };

      expect(evaluateConditions(condition, saveWithFlag)).toBe(true);
    });

    it("should evaluate array of conditions with OR logic", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);

      const conditions: Condition[] = [
        { op: "flag", path: "flag1", value: true },
        { op: "flag", path: "flag2", value: true },
      ];

      const saveWithFlags = {
        ...save,
        state: {
          ...save.state,
          flags: { ...save.state.flags, flag1: false, flag2: true },
        },
      };

      expect(evaluateConditions(conditions, saveWithFlags)).toBe(true);
    });

    it("should return false when all conditions in array are false", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);

      const conditions: Condition[] = [
        { op: "flag", path: "flag1", value: true },
        { op: "flag", path: "flag2", value: true },
      ];

      const saveWithFlags = {
        ...save,
        state: {
          ...save.state,
          flags: { ...save.state.flags, flag1: false, flag2: false },
        },
      };

      expect(evaluateConditions(conditions, saveWithFlags)).toBe(false);
    });
  });
});

