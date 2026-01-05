import { describe, it, expect } from "vitest";
import { getActorWeapon, getActorArmor, calculateWeaponDamage } from "./equipment";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import { FakeRng } from "../test-helpers/fakeRng";
import type { Weapon, Armor } from "../types";

describe("equipment", () => {
  describe("getActorWeapon", () => {
    it("should return unarmed weapon when actor has no weapon", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ equipment: { mainHand: null } });
      const save = makeTestSave(storyPack, actor);

      const result = getActorWeapon(save, actor);

      expect(result.weapon).toBeNull();
      expect(result.weaponId).toBe("unarmed");
      expect(result.name).toBe("Unarmed");
    });

    it("should return unarmed weapon when weaponId is not in weaponsById", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ equipment: { mainHand: { kind: "weapon", id: "nonexistent" } } });
      const save = makeTestSave(storyPack, actor);

      const result = getActorWeapon(save, actor);

      expect(result.weapon).toBeNull();
      expect(result.weaponId).toBe("unarmed");
      expect(result.name).toBe("Unarmed");
    });

    it("should return equipped weapon when actor has a weapon", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "sword",
        name: "Sword",
        kind: "MELEE",
        damage: { die: 10, add: 2 },
      };
      const actor = makeTestActor({ equipment: { mainHand: { kind: "weapon", id: "sword" } } });
      const save = {
        ...makeTestSave(storyPack, actor),
        weaponsById: { sword: weapon },
      };

      const result = getActorWeapon(save, actor);

      expect(result.weapon).toEqual(weapon);
      expect(result.weaponId).toBe("sword");
      expect(result.name).toBe("Sword");
    });

    it("should use mainHand from equipment when not explicitly provided", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "dagger",
        name: "Dagger",
        kind: "MELEE",
        damage: { die: 10, add: 1 },
      };
      const actor = makeTestActor({ equipment: { mainHand: { kind: "weapon", id: "dagger" } } });
      const save = {
        ...makeTestSave(storyPack, actor),
        weaponsById: { dagger: weapon },
      };

      const result = getActorWeapon(save, actor);

      expect(result.weaponId).toBe("dagger");
      expect(result.name).toBe("Dagger");
    });
  });

  describe("getActorArmor", () => {
    it("should return no armor when actor has no armor", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ equipment: { armor: null } });
      const save = makeTestSave(storyPack, actor);

      const result = getActorArmor(save, actor);

      expect(result.armor).toBeNull();
      expect(result.armorId).toBe("none");
      expect(result.name).toBe("None");
      expect(result.soak).toBe(0);
    });

    it("should return no armor when armorId is not in armorsById", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ equipment: { armor: { kind: "armor", id: "nonexistent" } } });
      const save = makeTestSave(storyPack, actor);

      const result = getActorArmor(save, actor);

      expect(result.armor).toBeNull();
      expect(result.armorId).toBe("none");
      expect(result.soak).toBe(0);
    });

    it("should return equipped armor when actor has armor", () => {
      const storyPack = makeTestStoryPack();
      const armor: Armor = {
        id: "leather",
        name: "Leather Armor",
        soak: 3,
      };
      const actor = makeTestActor({ equipment: { armor: { kind: "armor", id: "leather" } } });
      const save = {
        ...makeTestSave(storyPack, actor),
        armorsById: { leather: armor },
      };

      const result = getActorArmor(save, actor);

      expect(result.armor).toEqual(armor);
      expect(result.armorId).toBe("leather");
      expect(result.name).toBe("Leather Armor");
      expect(result.soak).toBe(3);
    });
  });

  describe("calculateWeaponDamage", () => {
    it("should calculate unarmed damage (1d5 + SB)", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ stats: { STR: 45 } }); // STR 45 -> SB 4
      const save = makeTestSave(storyPack, actor);
      // For d5 roll of 3, we need D100 value that maps to 3 in range [1, 5]
      const d100For3 = FakeRng.d100ForNextInt(3, 1, 5);
      const rng = new FakeRng([d100For3]);

      const result = calculateWeaponDamage(save, actor, null, rng);

      expect(result.weaponId).toBe("unarmed");
      expect(result.weaponName).toBe("Unarmed");
      expect(result.rawDamage).toBe(7); // 3 (roll) + 4 (SB)
    });

    it("should calculate unarmed damage with STR 0 (SB 0)", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ stats: { STR: 0 } });
      const save = makeTestSave(storyPack, actor);
      const d100For5 = FakeRng.d100ForNextInt(5, 1, 5);
      const rng = new FakeRng([d100For5]);

      const result = calculateWeaponDamage(save, actor, "unarmed", rng);

      expect(result.rawDamage).toBe(5); // 5 (roll) + 0 (SB)
    });

    it("should calculate Righteous Fury best-of-2 rolls", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "sword",
        name: "Sword",
        kind: "MELEE",
        damage: { die: 10, add: 2, bonus: "SB" },
      };
      const actor = makeTestActor({ stats: { STR: 50 } }); // SB 5
      const save = {
        ...makeTestSave(storyPack, actor),
        weaponsById: { sword: weapon },
      };
      // Roll 3 and 8, best is 8: 8 + 2 + 5 = 15
      const d100For3 = FakeRng.d100ForNextInt(3, 1, 10);
      const d100For8 = FakeRng.d100ForNextInt(8, 1, 10);
      const rng = new FakeRng([d100For3, d100For8]);

      const result = calculateWeaponDamage(save, actor, "sword", rng, 2);

      expect(result.rawDamage).toBe(15); // Best of (3+2+5=10, 8+2+5=15) = 15
    });

    it("should calculate Righteous Fury best-of-3 rolls for vengeful weapon", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "vengeful_sword",
        name: "Vengeful Sword",
        kind: "MELEE",
        damage: { die: 10, add: 2, bonus: "SB" },
        tags: ["vengeful:3"],
      };
      const actor = makeTestActor({ stats: { STR: 50 } }); // SB 5
      const save = {
        ...makeTestSave(storyPack, actor),
        weaponsById: { vengeful_sword: weapon },
      };
      // Roll 2, 7, 9, best is 9: 9 + 2 + 5 = 16
      const d100For2 = FakeRng.d100ForNextInt(2, 1, 10);
      const d100For7 = FakeRng.d100ForNextInt(7, 1, 10);
      const d100For9 = FakeRng.d100ForNextInt(9, 1, 10);
      const rng = new FakeRng([d100For2, d100For7, d100For9]);

      const result = calculateWeaponDamage(save, actor, "vengeful_sword", rng, 3);

      expect(result.rawDamage).toBe(16); // Best of (2+2+5=9, 7+2+5=14, 9+2+5=16) = 16
    });

    it("should calculate weapon damage without SB bonus", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "bow",
        name: "Bow",
        kind: "RANGED",
        damage: { die: 10, add: 3 },
      };
      const actor = makeTestActor({ stats: { STR: 50 } });
      const save = {
        ...makeTestSave(storyPack, actor),
        weaponsById: { bow: weapon },
      };
      const d100For7 = FakeRng.d100ForNextInt(7, 1, 10);
      const rng = new FakeRng([d100For7]);

      const result = calculateWeaponDamage(save, actor, "bow", rng);

      expect(result.rawDamage).toBe(10); // 7 (roll) + 3 (add), no SB
      expect(result.weaponId).toBe("bow");
      expect(result.weaponName).toBe("Bow");
    });

    it("should calculate melee weapon damage with SB bonus", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "sword",
        name: "Sword",
        kind: "MELEE",
        damage: { die: 10, add: 2, bonus: "SB" },
      };
      const actor = makeTestActor({ stats: { STR: 55 } }); // STR 55 -> SB 5
      const save = {
        ...makeTestSave(storyPack, actor),
        weaponsById: { sword: weapon },
      };
      const d100For6 = FakeRng.d100ForNextInt(6, 1, 10);
      const rng = new FakeRng([d100For6]);

      const result = calculateWeaponDamage(save, actor, "sword", rng);

      expect(result.rawDamage).toBe(13); // 6 (roll) + 2 (add) + 5 (SB)
      expect(result.weaponId).toBe("sword");
    });

    it("should handle weapon with no SB bonus specified", () => {
      const storyPack = makeTestStoryPack();
      const weapon: Weapon = {
        id: "staff",
        name: "Staff",
        kind: "MELEE",
        damage: { die: 10, add: 1 },
      };
      const actor = makeTestActor({ stats: { STR: 60 } }); // STR 60 -> SB 6
      const save = {
        ...makeTestSave(storyPack, actor),
        weaponsById: { staff: weapon },
      };
      const d100For4 = FakeRng.d100ForNextInt(4, 1, 10);
      const rng = new FakeRng([d100For4]);

      const result = calculateWeaponDamage(save, actor, "staff", rng);

      expect(result.rawDamage).toBe(5); // 4 (roll) + 1 (add), no SB
    });

    it("should handle nonexistent weapon as unarmed", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ stats: { STR: 40 } }); // STR 40 -> SB 4
      const save = makeTestSave(storyPack, actor);
      const d100For5 = FakeRng.d100ForNextInt(5, 1, 5); // Unarmed uses d5
      const rng = new FakeRng([d100For5]);

      const result = calculateWeaponDamage(save, actor, "nonexistent", rng);

      expect(result.weaponId).toBe("unarmed");
      expect(result.rawDamage).toBe(9); // 5 (roll) + 4 (SB)
    });
  });
});

