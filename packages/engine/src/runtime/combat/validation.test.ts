import { describe, it, expect } from "vitest";
import { validateAndApplyRangedModifiers } from "./validation";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import type { CombatAttackCheck, Weapon } from "../types";

describe("validation", () => {
  describe("validateAndApplyRangedModifiers", () => {
    it("should block non-ranged weapon", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "sword",
        name: "Sword",
        kind: "MELEE",
        damage: { tier: "single", add: 2 },
        damageType: "impact",
        penetration: 1,
      };
      const attacker = makeTestActor({
        id: "attacker",
        equipment: { mainHand: { kind: "weapon", id: "sword" } },
      });
      const defender = makeTestActor({ id: "defender" });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { sword: weapon },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "RANGED",
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result = validateAndApplyRangedModifiers(check, saveWithBoth, 5, "test_check", attacker.id);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
      expect(result?.tags).toContain("combat:blocked=notRangedWeapon");
    });

    it("should block ranged attack in melee range (dist <= 1)", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "bow",
        name: "Bow",
        kind: "RANGED",
        damage: { tier: "single", add: 3 },
        damageType: "impact",
        penetration: 1,
      };
      const attacker = makeTestActor({
        id: "attacker",
        equipment: { mainHand: { kind: "weapon", id: "bow" } },
      });
      const defender = makeTestActor({ id: "defender" });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { bow: weapon },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "RANGED",
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result = validateAndApplyRangedModifiers(check, saveWithBoth, 1, "test_check", attacker.id);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
      expect(result?.tags).toContain("combat:blocked=rangedInMelee");
      expect(result?.tags).toContain("combat:dist=1");
    });

    it("should block ranged attack out of range (dist > long)", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "bow",
        name: "Bow",
        kind: "RANGED",
        damage: { tier: "single", add: 3 },
        damageType: "impact",
        penetration: 1,
        range: { short: 4, long: 8 },
      };
      const attacker = makeTestActor({
        id: "attacker",
        equipment: { mainHand: { kind: "weapon", id: "bow" } },
      });
      const defender = makeTestActor({ id: "defender" });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { bow: weapon },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "RANGED",
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result = validateAndApplyRangedModifiers(check, saveWithBoth, 10, "test_check", attacker.id);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
      expect(result?.tags).toContain("combat:blocked=outOfRange");
    });

    it("should allow valid ranged attack within range", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "bow",
        name: "Bow",
        kind: "RANGED",
        damage: { tier: "single", add: 3 },
        damageType: "impact",
        penetration: 1,
        range: { short: 4, long: 8 },
      };
      const attacker = makeTestActor({
        id: "attacker",
        equipment: { mainHand: { kind: "weapon", id: "bow" } },
      });
      const defender = makeTestActor({ id: "defender" });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { bow: weapon },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "RANGED",
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result = validateAndApplyRangedModifiers(check, saveWithBoth, 5, "test_check", attacker.id);

      expect(result).toBeNull(); // Valid, no blocking
      // New global rule: dist 4..5 => NORMAL (not based on weapon.range.short anymore)
      expect(check.modifiers?.rangeBand).toBe("NORMAL");
    });

    it("should auto-set rangeBand to SHORT when dist <= short", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "bow",
        name: "Bow",
        kind: "RANGED",
        damage: { tier: "single", add: 3 },
        damageType: "impact",
        penetration: 1,
        range: { short: 4, long: 8 },
      };
      const attacker = makeTestActor({
        id: "attacker",
        equipment: { mainHand: { kind: "weapon", id: "bow" } },
      });
      const defender = makeTestActor({ id: "defender" });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { bow: weapon },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "RANGED",
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result = validateAndApplyRangedModifiers(check, saveWithBoth, 3, "test_check", attacker.id);

      expect(result).toBeNull();
      expect(check.modifiers?.rangeBand).toBe("SHORT"); // Auto-set to SHORT (3 <= 4)
    });

    it("should preserve existing rangeBand modifier", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "bow",
        name: "Bow",
        kind: "RANGED",
        damage: { tier: "single", add: 3 },
        damageType: "impact",
        penetration: 1,
        range: { short: 4, long: 8 },
      };
      const attacker = makeTestActor({
        id: "attacker",
        equipment: { mainHand: { kind: "weapon", id: "bow" } },
      });
      const defender = makeTestActor({ id: "defender" });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { bow: weapon },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "RANGED",
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        modifiers: { rangeBand: "SHORT" },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result = validateAndApplyRangedModifiers(check, saveWithBoth, 5, "test_check", attacker.id);

      expect(result).toBeNull();
      expect(check.modifiers?.rangeBand).toBe("SHORT"); // Preserved, not auto-set
    });

    it("should allow unlimited range when weapon has no range property", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "bow",
        name: "Bow",
        kind: "RANGED",
        damage: { tier: "single", add: 3 },
        damageType: "impact",
        penetration: 1,
        // No range property - unlimited range
      };
      const attacker = makeTestActor({
        id: "attacker",
        equipment: { mainHand: { kind: "weapon", id: "bow" } },
      });
      const defender = makeTestActor({ id: "defender" });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { bow: weapon },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "RANGED",
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      // Distance 9 - no range limit, so should be allowed
      // Range band will be EXTREME (-40) based on global rules
      const result = validateAndApplyRangedModifiers(check, saveWithBoth, 9, "test_check", attacker.id);

      expect(result).toBeNull(); // Not blocked - unlimited range
      expect(check.modifiers?.rangeBand).toBe("EXTREME"); // Auto-set based on distance
    });

    it("should auto-set rangeBand using global rules when weapon has no range", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "bow",
        name: "Bow",
        kind: "RANGED",
        damage: { tier: "single", add: 3 },
        damageType: "impact",
        penetration: 1,
      };
      const attacker = makeTestActor({
        id: "attacker",
        equipment: { mainHand: { kind: "weapon", id: "bow" } },
      });
      const defender = makeTestActor({ id: "defender" });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { bow: weapon },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "RANGED",
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      // Distance 3: global rule dist 2..3 => SHORT (+20)
      const result = validateAndApplyRangedModifiers(check, saveWithBoth, 3, "test_check", attacker.id);

      expect(result).toBeNull();
      expect(check.modifiers?.rangeBand).toBe("SHORT");
    });

    it("should handle missing attacker", () => {
      const storyPack = makeTestStoryPack();
      const defender = makeTestActor({ id: "defender" });
      const save = makeTestSave(storyPack, defender);

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: "nonexistent" },
          mode: "RANGED",
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result = validateAndApplyRangedModifiers(check, save, 5, "test_check", "nonexistent");

      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
      expect(result?.tags).toContain("combat:blocked=notRangedWeapon");
    });

    it("should use weaponId from check if provided", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "bow",
        name: "Bow",
        kind: "RANGED",
        damage: { tier: "single", add: 3 },
        damageType: "impact",
        penetration: 1,
      };
      const attacker = makeTestActor({
        id: "attacker",
        equipment: { mainHand: { kind: "weapon", id: "bow" } }, // Actor has bow equipped
      });
      const defender = makeTestActor({ id: "defender" });
      const save = {
        ...makeTestSave(storyPack, attacker),
        weaponsById: { bow: weapon },
      };
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };

      const check: CombatAttackCheck = {
        id: "test_check",
        kind: "combatAttack",
        attacker: {
          actorRef: { mode: "byId", actorId: attacker.id },
          mode: "RANGED",
          weaponId: "bow", // Check also specifies bow
        },
        defender: { actorRef: { mode: "byId", actorId: defender.id } },
        defense: {
          allowParry: undefined,
          allowDodge: undefined,
          strategy: "autoBest",
        },
      };

      const result = validateAndApplyRangedModifiers(check, saveWithBoth, 5, "test_check", attacker.id);

      expect(result).toBeNull(); // Valid, using bow
    });
  });
});
