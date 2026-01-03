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

    it("should apply unarmed damage correctly", () => {
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
      // Roll 7 on d10 for unarmed: 7 + 5 (SB) = 12 raw damage
      const d100For7 = FakeRng.d100ForNextInt(7, 1, 10);
      const rng = new FakeRng([d100For7]);

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
      expect(damageResult.finalDamage).toBe(12); // 12 raw - 0 soak
      expect(damageResult.save.actorsById[defender.id].resources.hp).toBe(88); // 100 - 12
      expect(damageResult.targetKo).toBe(false);
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
