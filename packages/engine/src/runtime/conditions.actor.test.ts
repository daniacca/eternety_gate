import { describe, it, expect } from "vitest";
import {
  hasCondition,
  getCondition,
  getStacks,
  addConditionToActor,
  removeConditionFromActor,
  computeCombatModifiersFromConditions,
} from "./conditions";
import { makeTestActor } from "./test-helpers/makeTestActor";
import { applyEffect, applyEffects } from "./effects";
import { makeTestSave } from "./test-helpers/makeTestSave";
import { makeTestStoryPack } from "./test-helpers/makeTestStoryPack";
import { RNG } from "./rng";
import type { Effect } from "./types";

describe("actor conditions", () => {
  describe("hasCondition", () => {
    it("should return false when actor has no conditions", () => {
      const actor = makeTestActor();
      expect(hasCondition(actor, "fatigue")).toBe(false);
    });

    it("should return true when actor has condition", () => {
      const actor = makeTestActor({
        conditions: {
          fatigue: { stacks: 2 },
        },
      });
      expect(hasCondition(actor, "fatigue")).toBe(true);
    });
  });

  describe("getStacks", () => {
    it("should return 1 when stacks not specified", () => {
      const actor = makeTestActor({
        conditions: {
          fatigue: {},
        },
      });
      expect(getStacks(actor, "fatigue")).toBe(1);
    });

    it("should return specified stacks", () => {
      const actor = makeTestActor({
        conditions: {
          fatigue: { stacks: 3 },
        },
      });
      expect(getStacks(actor, "fatigue")).toBe(3);
    });
  });

  describe("addConditionToActor", () => {
    it("should add condition immutably", () => {
      const actor = makeTestActor();
      const updated = addConditionToActor(actor, "fatigue", 2);
      
      expect(actor.conditions).toBeUndefined();
      expect(updated.conditions?.fatigue).toEqual({ stacks: 2 });
    });

    it("should preserve existing conditions", () => {
      const actor = makeTestActor({
        conditions: {
          prone: {},
        },
      });
      const updated = addConditionToActor(actor, "fatigue", 2);
      
      expect(updated.conditions?.prone).toBeDefined();
      expect(updated.conditions?.fatigue).toEqual({ stacks: 2 });
    });

    it("should ignore bleeding for undying actors", () => {
      const actor = makeTestActor({
        traits: {
          "trait:undying": {},
        },
      });
      const updated = addConditionToActor(actor, "bleeding", 1);

      expect(updated.conditions?.bleeding).toBeUndefined();
    });
  });

  describe("removeConditionFromActor", () => {
    it("should remove condition immutably", () => {
      const actor = makeTestActor({
        conditions: {
          fatigue: { stacks: 2 },
          prone: {},
        },
      });
      const updated = removeConditionFromActor(actor, "fatigue");
      
      expect(actor.conditions?.fatigue).toBeDefined();
      expect(updated.conditions?.fatigue).toBeUndefined();
      expect(updated.conditions?.prone).toBeDefined();
    });

    it("should remove conditions object when empty", () => {
      const actor = makeTestActor({
        conditions: {
          fatigue: {},
        },
      });
      const updated = removeConditionFromActor(actor, "fatigue");
      
      expect(updated.conditions).toBeUndefined();
    });
  });

  describe("computeCombatModifiersFromConditions", () => {
    it("should apply fatigue penalty to to-hit", () => {
      const actor = makeTestActor({
        conditions: {
          fatigue: { stacks: 2 },
        },
      });
      const mods = computeCombatModifiersFromConditions(actor);
      
      expect(mods.toHitPenalty).toBe(20); // 2 stacks * 10
      expect(mods.moveDelta).toBe(-2);
    });

    it("should cap fatigue penalty at -30", () => {
      const actor = makeTestActor({
        conditions: {
          fatigue: { stacks: 5 },
        },
      });
      const mods = computeCombatModifiersFromConditions(actor);
      
      expect(mods.toHitPenalty).toBe(30); // capped
      expect(mods.moveDelta).toBe(-5);
    });

    it("should apply prone move penalty", () => {
      const actor = makeTestActor({
        conditions: {
          prone: {},
        },
      });
      const mods = computeCombatModifiersFromConditions(actor);
      
      expect(mods.moveDelta).toBe(-1);
    });

    it("should disable parry/dodge when stunned", () => {
      const actor = makeTestActor({
        conditions: {
          stunned: {},
        },
      });
      const mods = computeCombatModifiersFromConditions(actor);
      
      expect(mods.allowParry).toBe(false);
      expect(mods.allowDodge).toBe(false);
    });
  });

  describe("addCondition effect", () => {
    it("should add condition to actor", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      
      const effect: Effect = {
        op: "addCondition",
        actorId: "PC_1",
        condition: "fatigue",
        stacks: 2,
      };
      
      const rng = new RNG(123, 0);
      const result = applyEffect(effect, storyPack, save, rng);
      
      expect(result.save.actorsById["PC_1"].conditions?.fatigue).toEqual({ stacks: 2 });
    });

    it("should calculate untilTurnCounter when in combat", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ id: "PC_1" });
      let save = makeTestSave(storyPack, actor);
      
      // Start combat
      const combatEffect: Effect = {
        op: "combatStart",
        participantIds: ["PC_1"],
        grid: { width: 10, height: 10 },
        placements: [],
      };
      const rng = new RNG(123, 0);
      save = applyEffect(combatEffect, storyPack, save, rng).save;
      
      const addConditionEffect: Effect = {
        op: "addCondition",
        actorId: "PC_1",
        condition: "stunned",
        durationTurns: 1,
      };
      
      const turnCounter = save.runtime.combat?.turnCounter ?? 0;
      const result = applyEffect(addConditionEffect, storyPack, save, rng);
      
      expect(result.save.actorsById["PC_1"].conditions?.stunned?.untilTurnCounter).toBe(turnCounter + 1);
    });
  });

  describe("removeCondition effect", () => {
    it("should remove condition from actor", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "PC_1",
        conditions: {
          fatigue: { stacks: 2 },
        },
      });
      const save = makeTestSave(storyPack, actor);
      
      const effect: Effect = {
        op: "removeCondition",
        actorId: "PC_1",
        condition: "fatigue",
      };
      
      const rng = new RNG(123, 0);
      const result = applyEffect(effect, storyPack, save, rng);
      
      expect(result.save.actorsById["PC_1"].conditions?.fatigue).toBeUndefined();
    });
  });
});

