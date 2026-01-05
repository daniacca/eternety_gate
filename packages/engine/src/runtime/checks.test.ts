import { describe, it, expect } from "vitest";
import { performCheck, resolveActor, getStatOrSkillValue } from "./checks";
import { makeTestSave } from "./test-helpers/makeTestSave";
import { makeTestStoryPack } from "./test-helpers/makeTestStoryPack";
import { makeTestActor } from "./test-helpers/makeTestActor";
import { FakeRng } from "./test-helpers/fakeRng";
import type { SingleCheck, OpposedCheck, SequenceCheck, MagicChannelCheck, MagicEffectCheck, CombatAttackCheck } from "./types";

describe("checks", () => {
  describe("resolveActor", () => {
    it("should resolve active actor when actorRef is undefined", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);

      const resolved = resolveActor(undefined, save);

      expect(resolved?.id).toBe("PC_1");
    });

    it("should resolve active actor when mode is active", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);

      const resolved = resolveActor({ mode: "active" }, save);

      expect(resolved?.id).toBe("PC_1");
    });

    it("should resolve actor by ID", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1" });
      const actor2 = makeTestActor({ id: "PC_2" });
      const save = makeTestSave(storyPack, actor1);
      const saveWithMultiple = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const resolved = resolveActor({ mode: "byId", actorId: "PC_2" }, saveWithMultiple);

      expect(resolved?.id).toBe("PC_2");
    });

    it("should resolve best of party actor", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1", stats: { STR: 30 } as any });
      const actor2 = makeTestActor({ id: "PC_2", stats: { STR: 70 } as any });
      const save = makeTestSave(storyPack, actor1);
      const saveWithMultiple = {
        ...save,
        party: {
          actors: ["PC_1", "PC_2"],
          activeActorId: "PC_1",
        },
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const resolved = resolveActor({ mode: "bestOfParty", key: "STR" }, saveWithMultiple);

      expect(resolved?.id).toBe("PC_2");
    });

    it("should return null for non-existent actor", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);

      const resolved = resolveActor({ mode: "byId", actorId: "NONEXISTENT" }, save);

      expect(resolved).toBeNull();
    });
  });

  describe("getStatOrSkillValue", () => {
    it("should return stat value", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ stats: { STR: 60 } as any });
      const save = makeTestSave(storyPack, actor);

      const value = getStatOrSkillValue(actor, "STR", save);

      expect(value).toBe(60);
    });

    it("should return skill value", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({ skills: { VATES: 40 } });
      const save = makeTestSave(storyPack, actor);

      const value = getStatOrSkillValue(actor, "SKILL:VATES", save);

      expect(value).toBe(40);
    });

    it("should apply equipment bonuses to stats", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        stats: { STR: 50 } as any,
        equipment: {
          offHand: { kind: "misc", id: "item1" },
        },
      });
      const save = makeTestSave(storyPack, actor);
      const saveWithItem = {
        ...save,
        itemCatalogById: {
          item1: {
            id: "item1",
            kind: "accessory" as const,
            name: "Strength Ring",
            tags: [],
            mods: [{ type: "bonusStat" as const, stat: "STR" as const, value: 10 }],
          },
        },
      };

      const value = getStatOrSkillValue(actor, "STR", saveWithItem);

      expect(value).toBe(60);
    });

    it("should apply equipment bonuses to skills", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        skills: { VATES: 50 },
        equipment: {
          offHand: { kind: "misc", id: "item1" },
        },
      });
      const save = makeTestSave(storyPack, actor);
      const saveWithItem = {
        ...save,
        itemCatalogById: {
          item1: {
            id: "item1",
            kind: "accessory" as const,
            name: "Skill Ring",
            tags: [],
            mods: [{ type: "bonusSkill" as const, skill: "VATES", value: 15 }],
          },
        },
      };

      const value = getStatOrSkillValue(actor, "SKILL:VATES", saveWithItem);

      expect(value).toBe(65);
    });

    it("should apply temp modifiers", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        stats: { STR: 50 } as any,
        status: {
          conditions: [],
          tempModifiers: [
            {
              id: "mod1",
              scope: "check",
              key: "STR",
              value: 10,
            },
          ],
        },
      });
      const save = makeTestSave(storyPack, actor);

      const value = getStatOrSkillValue(actor, "STR", save);

      expect(value).toBe(60);
    });

    it("should apply temp modifiers with scope 'all'", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        stats: { STR: 50 } as any,
        status: {
          conditions: [],
          tempModifiers: [
            {
              id: "mod1",
              scope: "all",
              key: "STR",
              value: 10,
            },
          ],
        },
      });
      const save = makeTestSave(storyPack, actor);

      const value = getStatOrSkillValue(actor, "STR", save);

      expect(value).toBe(60);
    });

    it("should not apply temp modifiers with scope 'combat' for checks", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        stats: { STR: 50 } as any,
        status: {
          conditions: [],
          tempModifiers: [
            {
              id: "mod1",
              scope: "combat",
              key: "STR",
              value: 10,
            },
          ],
        },
      });
      const save = makeTestSave(storyPack, actor);

      const value = getStatOrSkillValue(actor, "STR", save);

      expect(value).toBe(50);
    });
  });

  describe("performCheck - SingleCheck", () => {
    it("should perform a successful single check", () => {
      const storyPack = makeTestStoryPack({
        systems: {
          checks: {
            difficultyBands: { NORMAL: 0 },
            criticals: {
              autoSuccess: [1, 2, 3],
              autoFail: [98, 99, 100],
            },
          },
        },
      });
      const actor = makeTestActor({ stats: { STR: 50 } as any });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([30]); // Roll 30, target 50 -> success

      const check: SingleCheck = {
        id: "test_check",
        kind: "single",
        key: "STR",
        difficulty: "NORMAL",
      };

      const result = performCheck(check, storyPack, save, rng);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.roll).toBe(30);
      expect(result?.target).toBe(50);
    });

    it("should perform a failed single check", () => {
      const storyPack = makeTestStoryPack({
        systems: {
          checks: {
            difficultyBands: { NORMAL: 0 },
            criticals: {
              autoSuccess: [1, 2, 3],
              autoFail: [98, 99, 100],
            },
          },
        },
      });
      const actor = makeTestActor({ stats: { STR: 50 } as any });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([70]); // Roll 70, target 50 -> failure

      const check: SingleCheck = {
        id: "test_check",
        kind: "single",
        key: "STR",
        difficulty: "NORMAL",
      };

      const result = performCheck(check, storyPack, save, rng);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
      expect(result?.roll).toBe(70);
    });

    it("should handle difficulty modifiers", () => {
      const storyPack = makeTestStoryPack({
        systems: {
          checks: {
            difficultyBands: { NORMAL: 0, HARD: -20 },
            criticals: {
              autoSuccess: [1, 2, 3],
              autoFail: [98, 99, 100],
            },
          },
        },
      });
      const actor = makeTestActor({ stats: { STR: 50 } as any });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([30]); // Roll 30, target 30 (50-20) -> success

      const check: SingleCheck = {
        id: "test_check",
        kind: "single",
        key: "STR",
        difficulty: "HARD",
      };

      const result = performCheck(check, storyPack, save, rng);

      expect(result).not.toBeNull();
      expect(result?.target).toBe(30);
    });

    it("should return null when actor cannot be resolved", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([50]);

      const check: SingleCheck = {
        id: "test_check",
        kind: "single",
        actorRef: { mode: "byId", actorId: "NONEXISTENT" },
        key: "STR",
        difficulty: "NORMAL",
      };

      const result = performCheck(check, storyPack, save, rng);

      expect(result).toBeNull();
    });
  });

  describe("performCheck - OpposedCheck", () => {
    it("should perform opposed check when attacker wins", () => {
      const storyPack = makeTestStoryPack({
        systems: {
          checks: {
            difficultyBands: { NORMAL: 0 },
            criticals: {
              autoSuccess: [1, 2, 3],
              autoFail: [98, 99, 100],
            },
          },
        },
      });
      const attacker = makeTestActor({ id: "attacker", stats: { STR: 60 } as any });
      const defender = makeTestActor({ id: "defender", stats: { STR: 50 } as any });
      const save = makeTestSave(storyPack, attacker);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };
      // Attacker rolls 30 (success), defender rolls 60 (failure)
      const rng = new FakeRng([30, 60]);

      const check: OpposedCheck = {
        id: "opposed_check",
        kind: "opposed",
        attacker: { key: "STR", difficulty: "NORMAL" },
        defender: { actorRef: { mode: "byId", actorId: "defender" }, key: "STR", difficulty: "NORMAL" },
      };

      const result = performCheck(check, storyPack, saveWithBoth, rng);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.actorId).toBe("attacker");
    });

    it("should perform opposed check when defender wins", () => {
      const storyPack = makeTestStoryPack({
        systems: {
          checks: {
            difficultyBands: { NORMAL: 0 },
            criticals: {
              autoSuccess: [1, 2, 3],
              autoFail: [98, 99, 100],
            },
          },
        },
      });
      const attacker = makeTestActor({ id: "attacker", stats: { STR: 50 } as any });
      const defender = makeTestActor({ id: "defender", stats: { STR: 60 } as any });
      const save = makeTestSave(storyPack, attacker);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [defender.id]: defender,
        },
      };
      // Attacker rolls 60 (failure)
      const rng = new FakeRng([60, 30]);

      const check: OpposedCheck = {
        id: "opposed_check",
        kind: "opposed",
        attacker: { key: "STR", difficulty: "NORMAL" },
        defender: { actorRef: { mode: "byId", actorId: "defender" }, key: "STR", difficulty: "NORMAL" },
      };

      const result = performCheck(check, storyPack, saveWithBoth, rng);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
    });
  });

  describe("performCheck - SequenceCheck", () => {
    it("should succeed when all steps succeed", () => {
      const storyPack = makeTestStoryPack({
        systems: {
          checks: {
            difficultyBands: { NORMAL: 0 },
            criticals: {
              autoSuccess: [1, 2, 3],
              autoFail: [98, 99, 100],
            },
          },
        },
      });
      const actor = makeTestActor({ stats: { STR: 50, AGI: 50 } as any });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([30, 40]); // Both succeed

      const check: SequenceCheck = {
        id: "sequence_check",
        kind: "sequence",
        steps: [
          { id: "step1", kind: "single", key: "STR", difficulty: "NORMAL" },
          { id: "step2", kind: "single", key: "AGI", difficulty: "NORMAL" },
        ],
      };

      const result = performCheck(check, storyPack, save, rng);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
    });

    it("should fail when any step fails", () => {
      const storyPack = makeTestStoryPack({
        systems: {
          checks: {
            difficultyBands: { NORMAL: 0 },
            criticals: {
              autoSuccess: [1, 2, 3],
              autoFail: [98, 99, 100],
            },
          },
        },
      });
      const actor = makeTestActor({ stats: { STR: 50, AGI: 50 } as any });
      const save = makeTestSave(storyPack, actor);
      const rng = new FakeRng([30, 70]); // First succeeds, second fails

      const check: SequenceCheck = {
        id: "sequence_check",
        kind: "sequence",
        steps: [
          { id: "step1", kind: "single", key: "STR", difficulty: "NORMAL" },
          { id: "step2", kind: "single", key: "AGI", difficulty: "NORMAL" },
        ],
      };

      const result = performCheck(check, storyPack, save, rng);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
    });
  });

  describe("performCheck - MagicChannelCheck", () => {
    it("should succeed when DoS meets target", () => {
      const storyPack = makeTestStoryPack({
        systems: {
          checks: {
            difficultyBands: { NORMAL: 0 },
            criticals: {
              autoSuccess: [1, 2, 3],
              autoFail: [98, 99, 100],
            },
          },
        },
      });
      const actor = makeTestActor({ stats: { WIL: 50 } as any });
      const save = makeTestSave(storyPack, actor);
      // Roll 20, target 50 -> DoS 3, targetDoS 2 -> success
      const rng = new FakeRng([20]);

      const check: MagicChannelCheck = {
        id: "magic_channel",
        kind: "magicChannel",
        key: "WIL",
        difficulty: "NORMAL",
        targetDoS: 2,
      };

      const result = performCheck(check, storyPack, save, rng);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
    });

    it("should fail when DoS is insufficient", () => {
      const storyPack = makeTestStoryPack({
        systems: {
          checks: {
            difficultyBands: { NORMAL: 0 },
            criticals: {
              autoSuccess: [1, 2, 3],
              autoFail: [98, 99, 100],
            },
          },
        },
      });
      const actor = makeTestActor({ stats: { WIL: 50 } as any });
      const save = makeTestSave(storyPack, actor);
      // Roll 45, target 50 -> DoS 0, targetDoS 2 -> failure
      const rng = new FakeRng([45]);

      const check: MagicChannelCheck = {
        id: "magic_channel",
        kind: "magicChannel",
        key: "WIL",
        difficulty: "NORMAL",
        targetDoS: 2,
      };

      const result = performCheck(check, storyPack, save, rng);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
    });
  });

  describe("performCheck - MagicEffectCheck", () => {
    it("should succeed when DoS meets casting number", () => {
      const storyPack = makeTestStoryPack({
        systems: {
          checks: {
            difficultyBands: { NORMAL: 0 },
            criticals: {
              autoSuccess: [1, 2, 3],
              autoFail: [98, 99, 100],
            },
          },
        },
      });
      const actor = makeTestActor({ stats: { WIL: 50 } as any });
      const save = makeTestSave(storyPack, actor);
      // Roll 20, target 50 -> DoS 3, castingNumberDoS 2 -> success, extraDoS 1
      const rng = new FakeRng([20]);

      const check: MagicEffectCheck = {
        id: "magic_effect",
        kind: "magicEffect",
        key: "WIL",
        difficulty: "NORMAL",
        castingNumberDoS: 2,
      };

      const result = performCheck(check, storyPack, save, rng);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.dos).toBe(1); // Extra DoS
    });
  });
});

