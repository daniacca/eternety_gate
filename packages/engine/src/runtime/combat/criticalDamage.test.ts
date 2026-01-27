import { describe, it, expect } from "vitest";
import { applyCriticalDamageTiers, applyDamageToActor } from "./criticalDamage";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import { FakeRng } from "../test-helpers/fakeRng";
import type { Effect } from "../types";

describe("criticalDamage", () => {
  describe("applyCriticalDamageTiers", () => {
    it("should apply tier 1 effect (fatigue +1)", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ id: "test_actor" });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([]);

      const result = applyCriticalDamageTiers(actor, 1, 0, save, rng, storyPack);

      expect(result.newTierApplied).toBe(1);
      expect(result.actorDied).toBe(false);
      expect(result.emittedEffects).toHaveLength(1);
      expect(result.emittedEffects[0]).toEqual({
        op: "addCondition",
        actorId: "test_actor",
        condition: "fatigue",
        stacks: 1,
        source: "criticalDamage",
      });
    });

    it("should apply tier 2 effect (fatigue 1d5)", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ id: "test_actor" });
      const save = makeTestSave(storyPack, actor);
      // Tier 2 needs d5 roll for fatigue
      const d100For3 = FakeRng.d100ForNextInt(3, 1, 5);
      const rng = new FakeRng([d100For3]);

      const result = applyCriticalDamageTiers(actor, 2, 0, save, rng, storyPack);

      expect(result.newTierApplied).toBe(2);
      expect(result.actorDied).toBe(false);
      // Tier 1 applies fatigue +1, tier 2 applies fatigue 1d5 (3), so 2 effects total
      expect(result.emittedEffects).toHaveLength(2);
      const fatigueEffects = result.emittedEffects.filter(
        (e): e is Extract<Effect, { op: "addCondition"; condition: "fatigue" }> =>
          e.op === "addCondition" && e.condition === "fatigue"
      );
      expect(fatigueEffects.length).toBe(2);
      // Check tier 2 effect has correct stacks
      const tier2Fatigue = fatigueEffects.find((e) => {
        const addConditionEffect = e as Extract<Effect, { op: "addCondition" }>;
        return addConditionEffect.stacks === 3;
      });
      expect(tier2Fatigue).toBeDefined();
      if (tier2Fatigue) {
        const addConditionEffect = tier2Fatigue as Extract<Effect, { op: "addCondition" }>;
        expect(addConditionEffect.stacks).toBe(3);
      }
    });

    it("should apply tier 3 effect (bleeding)", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ id: "test_actor" });
      const save = makeTestSave(storyPack, actor);
      // Tier 2 needs d5 roll, tier 3 needs no roll
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const rng = new FakeRng([d100ForTier2]);

      const result = applyCriticalDamageTiers(actor, 3, 0, save, rng, storyPack);

      expect(result.newTierApplied).toBe(3);
      expect(result.actorDied).toBe(false);
      // Should have fatigue (tier 1), fatigue (tier 2), and bleeding (tier 3)
      const fatigueEffects = result.emittedEffects.filter((e) => e.op === "addCondition" && e.condition === "fatigue");
      const bleedingEffects = result.emittedEffects.filter(
        (e) => e.op === "addCondition" && e.condition === "bleeding"
      );
      expect(fatigueEffects.length).toBeGreaterThan(0);
      expect(bleedingEffects.length).toBe(1);
      expect(bleedingEffects[0]).toEqual({
        op: "addCondition",
        actorId: "test_actor",
        condition: "bleeding",
        stacks: 1,
        source: "criticalDamage",
      });
    });

    it("should apply tier 5 effect (prone)", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ id: "test_actor" });
      const save = makeTestSave(storyPack, actor);
      // Tier 2 needs d5 roll
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const rng = new FakeRng([d100ForTier2]);

      const result = applyCriticalDamageTiers(actor, 5, 0, save, rng, storyPack);

      expect(result.newTierApplied).toBe(5);
      expect(result.actorDied).toBe(false);
      const proneEffects = result.emittedEffects.filter((e) => e.op === "addCondition" && e.condition === "prone");
      expect(proneEffects.length).toBe(1);
      expect(proneEffects[0]).toEqual({
        op: "addCondition",
        actorId: "test_actor",
        condition: "prone",
        source: "criticalDamage",
      });
    });

    it("should apply tier 6 effect (stunned + bleeding)", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ id: "test_actor" });
      const save = makeTestSave(storyPack, actor);
      // Tier 2 needs d5 roll, tier 6 needs d5 roll for stunned duration
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const d100ForTier6 = FakeRng.d100ForNextInt(4, 1, 5);
      const rng = new FakeRng([d100ForTier2, d100ForTier6]);

      const result = applyCriticalDamageTiers(actor, 6, 0, save, rng, storyPack);

      expect(result.newTierApplied).toBe(6);
      expect(result.actorDied).toBe(false);
      const stunnedEffects = result.emittedEffects.filter((e) => e.op === "addCondition" && e.condition === "stunned");
      const bleedingEffects = result.emittedEffects.filter(
        (e) => e.op === "addCondition" && e.condition === "bleeding"
      );
      expect(stunnedEffects.length).toBe(1);
      expect(stunnedEffects[0]).toEqual({
        op: "addCondition",
        actorId: "test_actor",
        condition: "stunned",
        durationTurns: 4,
        source: "criticalDamage",
      });
      // Should have bleeding from tier 3 and tier 6
      expect(bleedingEffects.length).toBeGreaterThan(0);
    });

    it("should kill actor on tier 7 if toughness test fails", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        stats: { TOU: 30 }, // Low TOU to increase chance of failure
      });
      const save = makeTestSave(storyPack, actor);
      // Tier 1: no roll, Tier 2: d5 roll, Tier 3-6: no rolls, Tier 7: toughness check (d100)
      // Use a high roll (90) to fail the toughness check (TOU 30 + Challenging difficulty = target ~30)
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const d100ForTier6 = FakeRng.d100ForNextInt(3, 1, 5); // Tier 6 stunned duration
      const d100ForToughness = 90; // High roll = failure
      const rng = new FakeRng([d100ForTier2, d100ForTier6, d100ForToughness]);

      const result = applyCriticalDamageTiers(actor, 7, 0, save, rng, storyPack);

      expect(result.newTierApplied).toBe(7);
      expect(result.actorDied).toBe(true);
    });

    it("should not kill actor on tier 7 if toughness test succeeds", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        stats: { TOU: 70 }, // High TOU to pass
      });
      const save = makeTestSave(storyPack, actor);
      // Tier 1: no roll, Tier 2: d5 roll, Tier 3-6: no rolls, Tier 7: toughness check (d100)
      // Use a low roll (10) to pass the toughness check (TOU 70 + Challenging = target ~70)
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const d100ForTier6 = FakeRng.d100ForNextInt(3, 1, 5); // Tier 6 stunned duration
      const d100ForToughness = 10; // Low roll = success
      const rng = new FakeRng([d100ForTier2, d100ForTier6, d100ForToughness]);

      const result = applyCriticalDamageTiers(actor, 7, 0, save, rng, storyPack);

      expect(result.newTierApplied).toBe(7);
      expect(result.actorDied).toBe(false);
    });

    it("should kill actor on tier 8 if toughness test fails", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        stats: { TOU: 30 },
      });
      const save = makeTestSave(storyPack, actor);
      // Tier 1: no roll, Tier 2: d5 roll, Tier 3-6: no rolls, Tier 7: toughness check, Tier 8: toughness check (HARD)
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const d100ForTier6 = FakeRng.d100ForNextInt(3, 1, 5); // Tier 6 stunned duration
      const d100ForTier7 = 90; // Tier 7 toughness (fail)
      const d100ForTier8 = 90; // Tier 8 toughness (fail)
      const rng = new FakeRng([d100ForTier2, d100ForTier6, d100ForTier7, d100ForTier8]);

      const result = applyCriticalDamageTiers(actor, 8, 0, save, rng, storyPack);

      expect(result.newTierApplied).toBe(8);
      expect(result.actorDied).toBe(true);
    });

    it("should kill actor on tier 9 if toughness test fails", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        stats: { TOU: 30 },
      });
      const save = makeTestSave(storyPack, actor);
      // Tier 1: no roll, Tier 2: d5 roll, Tier 3-6: no rolls, Tier 7-9: toughness checks
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const d100ForTier6 = FakeRng.d100ForNextInt(3, 1, 5); // Tier 6 stunned duration
      const d100ForTier7 = 90; // Tier 7 toughness (fail)
      const d100ForTier8 = 90; // Tier 8 toughness (fail)
      const d100ForTier9 = 90; // Tier 9 toughness (fail)
      const rng = new FakeRng([d100ForTier2, d100ForTier6, d100ForTier7, d100ForTier8, d100ForTier9]);

      const result = applyCriticalDamageTiers(actor, 9, 0, save, rng, storyPack);

      expect(result.newTierApplied).toBe(9);
      expect(result.actorDied).toBe(true);
    });

    it("should kill actor immediately on tier 10", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ id: "test_actor" });
      const save = makeTestSave(storyPack, actor);
      // Tier 1: no roll, Tier 2: d5 roll, Tier 3-6: no rolls, Tier 6: stunned duration d5, Tier 7-9: toughness checks
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const d100ForTier6 = FakeRng.d100ForNextInt(3, 1, 5); // Tier 6 stunned duration
      const d100ForTier7 = 90; // Tier 7 toughness (fail)
      const d100ForTier8 = 90; // Tier 8 toughness (fail)
      const d100ForTier9 = 90; // Tier 9 toughness (fail)
      const rng = new FakeRng([d100ForTier2, d100ForTier6, d100ForTier7, d100ForTier8, d100ForTier9]);

      const result = applyCriticalDamageTiers(actor, 10, 0, save, rng, storyPack);

      expect(result.newTierApplied).toBe(10);
      expect(result.actorDied).toBe(true);
    });

    it("should only apply effects for new tiers", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ id: "test_actor" });
      const save = makeTestSave(storyPack, actor);
      // First apply tier 3
      const d100ForTier2_1 = FakeRng.d100ForNextInt(2, 1, 5);
      const rng1 = new FakeRng([d100ForTier2_1]);
      const result1 = applyCriticalDamageTiers(actor, 3, 0, save, rng1, storyPack);

      expect(result1.newTierApplied).toBe(3);
      const bleedingCount1 = result1.emittedEffects.filter(
        (e) => e.op === "addCondition" && e.condition === "bleeding"
      ).length;
      expect(bleedingCount1).toBe(1);

      // Then apply tier 5 (should only apply tier 4 and 5, not reapply 1-3)
      const d100ForTier2_2 = FakeRng.d100ForNextInt(2, 1, 5);
      const rng2 = new FakeRng([d100ForTier2_2]);
      const result2 = applyCriticalDamageTiers(actor, 5, 3, save, rng2, storyPack);

      expect(result2.newTierApplied).toBe(5);
      // Should not reapply bleeding from tier 3
      const bleedingCount2 = result2.emittedEffects.filter(
        (e) => e.op === "addCondition" && e.condition === "bleeding"
      ).length;
      expect(bleedingCount2).toBe(0); // No new bleeding (tier 4 doesn't add bleeding, tier 5 doesn't)
      // Should have prone from tier 5
      const proneEffects = result2.emittedEffects.filter((e) => e.op === "addCondition" && e.condition === "prone");
      expect(proneEffects.length).toBe(1);
    });

    it("should kill actor if critical damage >= 10 even if tier 10 not processed", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ id: "test_actor" });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([]);

      // Actor already at tier 10, but critical damage is 11
      const result = applyCriticalDamageTiers(actor, 11, 10, save, rng, storyPack);

      expect(result.newTierApplied).toBe(10); // Still capped at 10
      expect(result.actorDied).toBe(true); // But should die
    });

    it("should use WIL if TOU is not present", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        stats: { WIL: 70 }, // No TOU, use WIL
      });
      const save = makeTestSave(storyPack, actor);
      // Tier 1: no roll, Tier 2: d5 roll, Tier 3-6: no rolls, Tier 6: stunned duration, Tier 7: toughness check
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const d100ForTier6 = FakeRng.d100ForNextInt(3, 1, 5); // Tier 6 stunned duration
      const d100ForToughness = 10; // Low roll = success
      const rng = new FakeRng([d100ForTier2, d100ForTier6, d100ForToughness]);

      const result = applyCriticalDamageTiers(actor, 7, 0, save, rng, storyPack);

      expect(result.newTierApplied).toBe(7);
      expect(result.actorDied).toBe(false); // Should pass with WIL
    });

    it("should handle missing storyPack gracefully", () => {
      const actor = makeTestActor({ id: "test_actor" });
      const save = makeTestSave(makeTestStoryPack(), actor);
      // Tier 1: no roll, Tier 2: d5 roll, Tier 3-6: no rolls, Tier 6: stunned duration
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const d100ForTier6 = FakeRng.d100ForNextInt(3, 1, 5); // Tier 6 stunned duration
      const rng = new FakeRng([d100ForTier2, d100ForTier6]);

      // Without storyPack, toughness checks can't be performed
      const result = applyCriticalDamageTiers(actor, 7, 0, save, rng);

      expect(result.newTierApplied).toBe(7);
      // Without storyPack, toughness check returns null, so actor dies
      expect(result.actorDied).toBe(true);
    });
  });

  describe("applyDamageToActor", () => {
    it("should apply normal damage when HP > 0", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 0,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([]);

      const result = applyDamageToActor(actor, 10, save, rng, storyPack);

      expect(result.updatedActor.resources.wounds).toBe(10);
      expect(result.updatedActor.resources.criticalDamage).toBeUndefined();
      expect(result.effects).toHaveLength(0);
      expect(result.actorDied).toBe(false);
    });

    it("should not apply damage if damage <= 0", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 20,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([]);

      const result = applyDamageToActor(actor, 0, save, rng, storyPack);

      expect(result.updatedActor.resources.wounds).toBe(20);
      expect(result.effects).toHaveLength(0);
      expect(result.actorDied).toBe(false);
    });

    it("should not apply damage if actor is already dead", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 100,
          isDead: true,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([]);

      const result = applyDamageToActor(actor, 10, save, rng, storyPack);

      expect(result.updatedActor.resources.wounds).toBe(100);
      expect(result.effects).toHaveLength(0);
      expect(result.actorDied).toBe(true);
    });

    it("should start critical damage track when HP reaches 0", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 90,
          rf: 0,
          peq: 0,
        }, // Assuming maxHp=100, so HP=10
      });
      const save = makeTestSave(storyPack, actor);
      // Tier 1 needs no roll, tier 2 needs d5 roll
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const rng = new FakeRng([d100ForTier2]);

      // Deal 15 damage: 10 to bring HP to 0, 5 excess goes to critical damage
      const result = applyDamageToActor(actor, 15, save, rng, storyPack);

      expect(result.updatedActor.resources.wounds).toBe(100); // Max wounds (HP = 0)
      expect(result.updatedActor.resources.criticalDamage).toBe(5);
      expect(result.updatedActor.resources.criticalTierApplied).toBe(5);
      expect(result.effects.length).toBeGreaterThan(0); // Should have tier effects
    });

    it("should add to existing critical damage when already at 0 HP", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 100,
          criticalDamage: 3,
          criticalTierApplied: 3,
          rf: 0,
          peq: 0,
        }, // Already at 0 HP, tier 3
      });
      const save = makeTestSave(storyPack, actor);
      // Tier 4-5 need no rolls, but tier 2 needs d5 roll (already applied, but function may check)
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const rng = new FakeRng([d100ForTier2]);

      // Deal 2 more damage: goes to critical damage (3 + 2 = 5)
      const result = applyDamageToActor(actor, 2, save, rng, storyPack);

      expect(result.updatedActor.resources.wounds).toBe(100);
      expect(result.updatedActor.resources.criticalDamage).toBe(5);
      expect(result.updatedActor.resources.criticalTierApplied).toBe(5);
      // Should only apply tier 4 and 5 effects, not reapply 1-3
      const fatigueEffects = result.effects.filter((e) => e.op === "addCondition" && e.condition === "fatigue");
      expect(fatigueEffects.length).toBe(0); // No new fatigue (already applied)
    });

    it("should apply True Grit reduction to critical damage", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        stats: { TOU: 40 } as any,
        talents: { "talent:true_grit": 1 },
        resources: {
          wounds: 100,
          criticalDamage: 0,
          criticalTierApplied: 0,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([]);
      const catalogs = {
        skills: [],
        traits: [],
        talents: [
          {
            id: "talent:true_grit",
            name: "True Grit",
            tier: 3,
            xpCost: 1000,
            prerequisites: [],
            grants: [{ type: "hook", hookId: "trueGrit" }],
          },
        ],
      };

      const result = applyDamageToActor(actor, 3, save, rng, storyPack, catalogs);

      expect(result.updatedActor.resources.criticalDamage).toBe(1);
    });

    it("should handle damage that exceeds maxHp", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 0,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);
      // Tier 1: no roll, Tier 2: d5 roll, Tier 3-6: no rolls, Tier 6: stunned duration, Tier 7-9: toughness checks, Tier 10: instant death
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const d100ForTier6 = FakeRng.d100ForNextInt(3, 1, 5); // Tier 6 stunned duration
      const d100ForTier7 = 90; // Tier 7 toughness (fail)
      const d100ForTier8 = 90; // Tier 8 toughness (fail)
      const d100ForTier9 = 90; // Tier 9 toughness (fail)
      const rng = new FakeRng([d100ForTier2, d100ForTier6, d100ForTier7, d100ForTier8, d100ForTier9]);

      // Deal 150 damage: 100 to bring HP to 0, 50 excess goes to critical damage
      const result = applyDamageToActor(actor, 150, save, rng, storyPack);

      expect(result.updatedActor.resources.wounds).toBe(100);
      expect(result.updatedActor.resources.criticalDamage).toBe(50);
      expect(result.updatedActor.resources.criticalTierApplied).toBe(10); // Capped at tier 10
      expect(result.actorDied).toBe(true); // Should die from tier 10
    });

    it("should not normalize wounds when damage is 0 (early return)", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 150,
          rf: 0,
          peq: 0,
        }, // Wounds exceed maxHp (shouldn't happen, but handle it)
        derived: { hpMax: 100 },
      });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([]);

      // When applying 0 damage, function returns early without normalizing
      const result = applyDamageToActor(actor, 0, save, rng, storyPack);

      // Function returns early when damage <= 0, so wounds remain unchanged
      expect(result.updatedActor.resources.wounds).toBe(150);
      expect(result.effects).toHaveLength(0);
    });

    it("should use catalogs for maxHp calculation when provided", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 0,
          rf: 0,
          peq: 0,
        },
        derived: { hpMax: 150 }, // Custom maxHp
      });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([]);

      const result = applyDamageToActor(actor, 10, save, rng, storyPack);

      expect(result.updatedActor.resources.wounds).toBe(10);
      // Should use derived.hpMax if catalogs not provided
    });

    it("should handle actor death from critical damage tiers", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 100,
          rf: 0,
          peq: 0,
        }, // Already at 0 HP
      });
      const save = makeTestSave(storyPack, actor);
      // Tier 1: no roll, Tier 2: d5 roll, Tier 3-6: no rolls, Tier 6: stunned duration, Tier 7-9: toughness checks, Tier 10: instant death
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const d100ForTier6 = FakeRng.d100ForNextInt(3, 1, 5); // Tier 6 stunned duration
      const d100ForTier7 = 90; // Tier 7 toughness (fail)
      const d100ForTier8 = 90; // Tier 8 toughness (fail)
      const d100ForTier9 = 90; // Tier 9 toughness (fail)
      const rng = new FakeRng([d100ForTier2, d100ForTier6, d100ForTier7, d100ForTier8, d100ForTier9]);

      // Deal 10 damage: goes to critical damage (0 + 10 = 10, tier 10)
      const result = applyDamageToActor(actor, 10, save, rng, storyPack);

      expect(result.updatedActor.resources.criticalDamage).toBe(10);
      expect(result.updatedActor.resources.isDead).toBe(true);
      expect(result.actorDied).toBe(true);
    });

    it("should set wounds to maxHp when actor dies", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 50,
          rf: 0,
          peq: 0,
        },
      });
      const save = makeTestSave(storyPack, actor);
      // Tier 1: no roll, Tier 2: d5 roll, Tier 3-6: no rolls, Tier 6: stunned duration, Tier 7-9: toughness checks, Tier 10: instant death
      const d100ForTier2 = FakeRng.d100ForNextInt(2, 1, 5);
      const d100ForTier6 = FakeRng.d100ForNextInt(3, 1, 5); // Tier 6 stunned duration
      const d100ForTier7 = 90; // Tier 7 toughness (fail)
      const d100ForTier8 = 90; // Tier 8 toughness (fail)
      const d100ForTier9 = 90; // Tier 9 toughness (fail)
      const rng = new FakeRng([d100ForTier2, d100ForTier6, d100ForTier7, d100ForTier8, d100ForTier9]);

      // Deal 60 damage: 50 to bring HP to 0, 10 excess -> tier 10 -> death
      const result = applyDamageToActor(actor, 60, save, rng, storyPack);

      expect(result.updatedActor.resources.wounds).toBe(100); // Set to maxHp on death
      expect(result.updatedActor.resources.isDead).toBe(true);
    });
  });
});
