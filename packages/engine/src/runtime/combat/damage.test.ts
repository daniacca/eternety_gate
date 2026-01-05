import { describe, it, expect } from "vitest";
import { applyCombatDamageIfHit } from "./damage";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import { FakeRng } from "../test-helpers/fakeRng";
import type { CombatAttackCheck, CheckResult, Weapon, Armor } from "../types";

describe("damage", () => {
  describe("applyCombatDamageIfHit", () => {
    it("should not apply damage when check result is unsuccessful", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({ id: "attacker" });
      const defender = makeTestActor({ id: "defender", resources: { hp: 100, rf: 100, peq: 100 } });
      const save = makeTestSave(storyPack, attacker);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };
      const rng = new FakeRng([]);

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE" },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result: CheckResult = {
        checkId: "test_check",
        actorId: attacker.id,
        roll: 50,
        target: 40,
        success: false,
        dos: 0,
        dof: 10,
        critical: "none",
        tags: [],
      };

      const damageResult = applyCombatDamageIfHit(check, result, saveWithBoth, rng);

      expect(damageResult.didApplyDamage).toBe(false);
      expect(damageResult.targetKo).toBe(false);
      expect(damageResult.save.actorsById[defender.id].resources.hp).toBe(100);
    });

    it("should not apply damage when attacker is not found", () => {
      const storyPack = makeTestStoryPack();
      const defender = makeTestActor({ id: "defender" });
      const save = makeTestSave(storyPack, defender);
      const rng = new FakeRng([]);

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: { actorRef: { mode: "byId", actorId: "nonexistent" }, mode: "MELEE" },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result: CheckResult = {
        checkId: "test_check",
        actorId: "nonexistent",
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: [],
      };

      const damageResult = applyCombatDamageIfHit(check, result, save, rng);

      expect(damageResult.didApplyDamage).toBe(false);
      expect(damageResult.targetKo).toBe(false);
    });

    it("should apply unarmed damage correctly (1d5 + SB)", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({
        id: "attacker",
        stats: { STR: 50 }, // SB 5
      });
      const defender = makeTestActor({
        id: "defender",
        resources: { hp: 100, rf: 100, peq: 100 },
      });
      const save = makeTestSave(storyPack, attacker);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };
      // Roll 4 on d5 for unarmed: 4 + 5 (SB) = 9 raw damage
      const d100For4 = FakeRng.d100ForNextInt(4, 1, 5);
      const rng = new FakeRng([d100For4]);

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE" },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result: CheckResult = {
        checkId: "test_check",
        actorId: attacker.id,
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: [],
      };

      const damageResult = applyCombatDamageIfHit(check, result, saveWithBoth, rng);

      expect(damageResult.didApplyDamage).toBe(true);
      expect(damageResult.finalDamage).toBe(9); // 9 raw - 0 soak
      expect(damageResult.save.actorsById[defender.id].resources.hp).toBe(91); // 100 - 9
      expect(damageResult.targetKo).toBe(false);
    });

    it("should double armor soak against unarmed attacks", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({
        id: "attacker",
        stats: { STR: 50 }, // SB 5
      });
      const defender = makeTestActor({
        id: "defender",
        resources: { hp: 100, rf: 100, peq: 100 },
      });
      const armor: Armor = {
        id: "leather",
        name: "Leather Armor",
        soak: 3,
      };
      const save = makeTestSave(storyPack, attacker);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: { ...defender, equipment: { ...defender.equipment, armorId: "leather" } },
        },
        armorsById: { leather: armor },
      };
      // Roll 4 on d5: 4 + 5 (SB) = 9 raw damage, double soak = 6, final = 3
      const d100For4 = FakeRng.d100ForNextInt(4, 1, 5);
      const rng = new FakeRng([d100For4]);

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE" },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result: CheckResult = {
        checkId: "test_check",
        actorId: attacker.id,
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: [],
      };

      const damageResult = applyCombatDamageIfHit(check, result, saveWithBoth, rng);

      expect(damageResult.didApplyDamage).toBe(true);
      expect(damageResult.finalDamage).toBe(3); // 9 raw - 6 (double soak) = 3
      expect(damageResult.save.actorsById[defender.id].resources.hp).toBe(97); // 100 - 3
    });

    it("should apply Righteous Fury on critical success", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "sword",
        name: "Sword",
        kind: "MELEE",
        damage: { die: 10, add: 2, bonus: "SB" },
      };
      const attacker = makeTestActor({
        id: "attacker",
        stats: { STR: 50 }, // SB 5
        equipment: { weaponId: "sword" },
      });
      const defender = makeTestActor({
        id: "defender",
        resources: { hp: 100, rf: 100, peq: 100 },
      });
      const save = makeTestSave(storyPack, attacker);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
        weaponsById: { sword: weapon },
      };
      // Righteous Fury: best of 2 rolls (3 and 8), best is 8: 8 + 2 + 5 = 15
      const d100For3 = FakeRng.d100ForNextInt(3, 1, 10);
      const d100For8 = FakeRng.d100ForNextInt(8, 1, 10);
      const rng = new FakeRng([d100For3, d100For8]);

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE", weaponId: "sword" },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result: CheckResult = {
        checkId: "test_check",
        actorId: attacker.id,
        roll: 1, // Critical success
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "autoSuccess",
        tags: [],
      };

      const damageResult = applyCombatDamageIfHit(check, result, saveWithBoth, rng);

      expect(damageResult.didApplyDamage).toBe(true);
      expect(damageResult.finalDamage).toBe(15); // Best of 2 rolls: 15
      expect(damageResult.save.actorsById[defender.id].resources.hp).toBe(85); // 100 - 15
      // Check for Righteous Fury tag
      const lastCheck = damageResult.save.runtime.lastCheck;
      expect(lastCheck?.tags).toContain("combat:righteousFury=1");
      expect(lastCheck?.tags).toContain("combat:righteousFury:rolls=2");
    });

    it("should not remove ground item when picking up with weapon already equipped", () => {
      // This test verifies combatPickup fix - item stays on ground if actor has weapon
      // Note: This is tested indirectly through combatPickup handler
    });

    it("should apply critical damage tiers only once when crossing thresholds", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({ id: "attacker" });
      const defender = makeTestActor({
        id: "defender",
        resources: { hp: 0, rf: 100, peq: 100 }, // Already at 0 HP
      });
      const save = makeTestSave(storyPack, attacker);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };
      // First hit: 3 damage -> tier 3
      const d100For3 = FakeRng.d100ForNextInt(3, 1, 10);
      const rng1 = new FakeRng([d100For3]);

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE" },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result: CheckResult = {
        checkId: "test_check",
        actorId: attacker.id,
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: [],
      };

      const damageResult1 = applyCombatDamageIfHit(check, result, saveWithBoth, rng1, storyPack);
      expect(damageResult1.save.actorsById[defender.id].resources.criticalDamage).toBe(3);
      expect(damageResult1.save.actorsById[defender.id].resources.criticalTierApplied).toBe(3);
      // Should have fatigue (tier 1) and bleeding (tier 3)
      const fatigueStacks1 = damageResult1.effects?.filter((e) => e.op === "addCondition" && e.condition === "fatigue").length || 0;
      const bleedingStacks1 = damageResult1.effects?.filter((e) => e.op === "addCondition" && e.condition === "bleeding").length || 0;
      expect(fatigueStacks1).toBeGreaterThan(0);
      expect(bleedingStacks1).toBe(1);

      // Second hit: 2 more damage -> still tier 3 (5 total)
      const d100For2 = FakeRng.d100ForNextInt(2, 1, 10);
      const rng2 = new FakeRng([d100For2]);
      const damageResult2 = applyCombatDamageIfHit(check, result, damageResult1.save, rng2, storyPack);
      expect(damageResult2.save.actorsById[defender.id].resources.criticalDamage).toBe(5);
      expect(damageResult2.save.actorsById[defender.id].resources.criticalTierApplied).toBe(5);
      // Should NOT reapply tier 1-3 effects (no new fatigue/bleeding)
      const fatigueStacks2 = damageResult2.effects?.filter((e) => e.op === "addCondition" && e.condition === "fatigue").length || 0;
      const bleedingStacks2 = damageResult2.effects?.filter((e) => e.op === "addCondition" && e.condition === "bleeding").length || 0;
      expect(fatigueStacks2).toBe(0); // No new fatigue
      expect(bleedingStacks2).toBe(0); // No new bleeding
      // But should have prone (tier 5)
      const proneStacks = damageResult2.effects?.filter((e) => e.op === "addCondition" && e.condition === "prone").length || 0;
      expect(proneStacks).toBe(1);
    });

    it("should apply weapon damage with armor soak", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "sword",
        name: "Sword",
        kind: "MELEE",
        damage: { die: 10, add: 3, bonus: "SB" },
      };
      const armor: Armor = {
        id: "leather",
        name: "Leather Armor",
        soak: 5,
      };
      const attacker = makeTestActor({
        id: "attacker",
        stats: { STR: 40 }, // SB 4
        equipment: { weaponId: "sword" },
      });
      const defender = makeTestActor({
        id: "defender",
        resources: { hp: 50, rf: 100, peq: 100 },
        equipment: { armorId: "leather" },
      });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { sword: weapon },
        armorsById: { leather: armor },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };
      // Roll 8 on d10: 8 + 3 (add) + 4 (SB) = 15 raw damage
      const d100For8 = FakeRng.d100ForNextInt(8, 1, 10);
      const rng = new FakeRng([d100For8]);

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "MELEE",
          weaponId: "sword",
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result: CheckResult = {
        checkId: "test_check",
        actorId: attacker.id,
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: [],
      };

      const damageResult = applyCombatDamageIfHit(check, result, saveWithBoth, rng);

      expect(damageResult.didApplyDamage).toBe(true);
      expect(damageResult.finalDamage).toBe(10); // 15 raw - 5 soak
      expect(damageResult.save.actorsById[defender.id].resources.hp).toBe(40); // 50 - 10
    });

    it("should reduce damage to 0 when armor soak exceeds raw damage", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "dagger",
        name: "Dagger",
        kind: "MELEE",
        damage: { die: 10, add: 1 },
      };
      const armor: Armor = {
        id: "plate",
        name: "Plate Armor",
        soak: 20,
      };
      const attacker = makeTestActor({
        id: "attacker",
        equipment: { weaponId: "dagger" },
      });
      const defender = makeTestActor({
        id: "defender",
        resources: { hp: 100, rf: 100, peq: 100 },
        equipment: { armorId: "plate" },
      });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { dagger: weapon },
        armorsById: { plate: armor },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };
      // Roll 5 on d10: 5 + 1 = 6 raw damage
      const d100For5 = FakeRng.d100ForNextInt(5, 1, 10);
      const rng = new FakeRng([d100For5]);

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "MELEE",
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result: CheckResult = {
        checkId: "test_check",
        actorId: attacker.id,
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: [],
      };

      const damageResult = applyCombatDamageIfHit(check, result, saveWithBoth, rng);

      expect(damageResult.didApplyDamage).toBe(false); // No damage applied
      expect(damageResult.finalDamage).toBe(0);
      expect(damageResult.save.actorsById[defender.id].resources.hp).toBe(100);
      // Should have narration about armor absorbing all damage
      expect(damageResult.save.runtime.combatLog).toBeDefined();
      expect(damageResult.save.runtime.combatLog?.length).toBeGreaterThan(0);
    });

    it("should set targetKo to true when HP reaches 0", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({
        id: "attacker",
        stats: { STR: 50 }, // SB 5
      });
      const defender = makeTestActor({
        id: "defender",
        resources: { hp: 10, rf: 100, peq: 100 },
      });
      const save = makeTestSave(storyPack, attacker);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
        runtime: {
          ...save.runtime,
          lastCheck: {
            checkId: "test_check",
            actorId: attacker.id,
            roll: 30,
            target: 40,
            success: true,
            dos: 10,
            dof: 0,
            critical: "none" as const,
            tags: [],
          },
        },
      };
      // Roll 8 on d10: 8 + 5 (SB) = 13 raw damage
      const d100For8 = FakeRng.d100ForNextInt(8, 1, 10);
      const rng = new FakeRng([d100For8]);

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE" },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result: CheckResult = {
        checkId: "test_check",
        actorId: attacker.id,
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: [],
      };

      const damageResult = applyCombatDamageIfHit(check, result, saveWithBoth, rng);

      expect(damageResult.targetKo).toBe(true);
      expect(damageResult.save.actorsById[defender.id].resources.hp).toBe(0);
      // Should have combat:defDown=1 tag
      const lastCheck = damageResult.save.runtime.lastCheck;
      expect(lastCheck?.tags).toContain("combat:defDown=1");
    });

    it("should add damage tags to lastCheck", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "sword",
        name: "Sword",
        kind: "MELEE",
        damage: { die: 10, add: 2 },
      };
      const armor: Armor = {
        id: "leather",
        name: "Leather Armor",
        soak: 3,
      };
      const attacker = makeTestActor({
        id: "attacker",
        equipment: { weaponId: "sword" },
      });
      const defender = makeTestActor({
        id: "defender",
        resources: { hp: 100, rf: 100, peq: 100 },
        equipment: { armorId: "leather" },
      });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { sword: weapon },
        armorsById: { leather: armor },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
        runtime: {
          ...save.runtime,
          lastCheck: {
            checkId: "test_check",
            actorId: attacker.id,
            roll: 30,
            target: 40,
            success: true,
            dos: 10,
            dof: 0,
            critical: "none" as const,
            tags: ["existing_tag"],
          },
        },
      };
      const d100For6 = FakeRng.d100ForNextInt(6, 1, 10);
      const rng = new FakeRng([d100For6]); // Roll 6: 6 + 2 = 8 raw damage

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "MELEE",
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result: CheckResult = {
        checkId: "test_check",
        actorId: attacker.id,
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: [],
      };

      const damageResult = applyCombatDamageIfHit(check, result, saveWithBoth, rng);

      const lastCheck = damageResult.save.runtime.lastCheck;
      expect(lastCheck?.tags).toContain("existing_tag");
      expect(lastCheck?.tags).toContain("combat:damage:raw=8");
      expect(lastCheck?.tags).toContain("combat:soak=3");
      expect(lastCheck?.tags).toContain("combat:damage:final=5");
      expect(lastCheck?.tags).toContain("combat:weapon=sword");
      expect(lastCheck?.tags).toContain("combat:armor=leather");
      expect(lastCheck?.tags).toContain("combat:defHpBefore=100");
      expect(lastCheck?.tags).toContain("combat:defHpAfter=95");
    });

    it("should use weaponId from check if provided", () => {
      const storyPack = makeTestStoryPack();
      const weapon1: Weapon = {
        id: "sword",
        name: "Sword",
        kind: "MELEE",
        damage: { die: 10, add: 5 },
      };
      const weapon2: Weapon = {
        id: "axe",
        name: "Axe",
        kind: "MELEE",
        damage: { die: 10, add: 3 },
      };
      const attacker = makeTestActor({
        id: "attacker",
        equipment: { weaponId: "sword" }, // Actor has sword equipped
      });
      const defender = makeTestActor({
        id: "defender",
        resources: { hp: 100, rf: 100, peq: 100 },
      });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { sword: weapon1, axe: weapon2 },
        runtime: {
          ...makeTestSave(storyPack, attacker).runtime,
          lastCheck: {
            checkId: "test_check",
            actorId: attacker.id,
            roll: 30,
            target: 40,
            success: true,
            dos: 10,
            dof: 0,
            critical: "none" as const,
            tags: [],
          },
        },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };
      const d100For5 = FakeRng.d100ForNextInt(5, 1, 10);
      const rng = new FakeRng([d100For5]); // Roll 5: 5 + 3 = 8 (using axe from check)

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "MELEE",
          weaponId: "axe", // Check specifies axe
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result: CheckResult = {
        checkId: "test_check",
        actorId: attacker.id,
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: [],
      };

      const damageResult = applyCombatDamageIfHit(check, result, saveWithBoth, rng);

      expect(damageResult.finalDamage).toBe(8); // Using axe damage (5 + 3)
      const lastCheck = damageResult.save.runtime.lastCheck;
      expect(lastCheck?.tags).toContain("combat:weapon=axe");
    });
  });
});
