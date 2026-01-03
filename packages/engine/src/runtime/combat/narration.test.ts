import { describe, it, expect } from "vitest";
import { appendCombatLog, appendAttackNarration } from "./narration";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import type { CheckResult } from "../types";

describe("narration", () => {
  describe("appendCombatLog", () => {
    it("should append entry to empty log", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);

      const result = appendCombatLog(save, "Test message");

      expect(result.runtime.combatLog).toEqual(["Test message"]);
    });

    it("should append entry to existing log", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = {
        ...makeTestSave(storyPack, actor),
        runtime: {
          ...makeTestSave(storyPack, actor).runtime,
          combatLog: ["First message"],
        },
      };

      const result = appendCombatLog(save, "Second message");

      expect(result.runtime.combatLog).toEqual(["First message", "Second message"]);
    });

    it("should trim log to last 50 entries", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const existingLog = Array.from({ length: 50 }, (_, i) => `Message ${i}`);
      const save = {
        ...makeTestSave(storyPack, actor),
        runtime: {
          ...makeTestSave(storyPack, actor).runtime,
          combatLog: existingLog,
        },
      };

      const result = appendCombatLog(save, "New message");

      expect(result.runtime.combatLog).toBeDefined();
      expect(result.runtime.combatLog?.length).toBe(50);
      expect(result.runtime.combatLog?.[0]).toBe("Message 1"); // First entry removed
      expect(result.runtime.combatLog?.[49]).toBe("New message"); // Last entry is new
    });

    it("should adjust combatTurnStartIndex when log is trimmed", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const existingLog = Array.from({ length: 50 }, (_, i) => `Message ${i}`);
      const save = {
        ...makeTestSave(storyPack, actor),
        runtime: {
          ...makeTestSave(storyPack, actor).runtime,
          combatLog: existingLog,
          combatTurnStartIndex: 5,
        },
      };

      const result = appendCombatLog(save, "New message");

      // Index should be adjusted: 5 - 1 = 4 (one entry was removed)
      expect(result.runtime.combatTurnStartIndex).toBe(4);
    });

    it("should not adjust combatTurnStartIndex when it would go negative", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const existingLog = Array.from({ length: 50 }, (_, i) => `Message ${i}`);
      const save = {
        ...makeTestSave(storyPack, actor),
        runtime: {
          ...makeTestSave(storyPack, actor).runtime,
          combatLog: existingLog,
          combatTurnStartIndex: 0,
        },
      };

      const result = appendCombatLog(save, "New message");

      expect(result.runtime.combatTurnStartIndex).toBe(0); // Clamped to 0
    });

    it("should handle undefined combatTurnStartIndex", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);

      const result = appendCombatLog(save, "Test message");

      expect(result.runtime.combatTurnStartIndex).toBeUndefined();
    });
  });

  describe("appendAttackNarration", () => {
    it("should return save unchanged when result is null", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({ id: "attacker" });
      const defender = makeTestActor({ id: "defender" });
      const save = makeTestSave(storyPack, attacker);

      const result = appendAttackNarration(save, attacker, defender, null);

      expect(result).toBe(save);
      expect(result.runtime.combatLog).toBeUndefined();
    });

    it("should return save unchanged when attacker is null", () => {
      const storyPack = makeTestStoryPack();
      const defender = makeTestActor({ id: "defender" });
      const save = makeTestSave(storyPack, defender);
      const checkResult: CheckResult = {
        checkId: "test",
        actorId: "attacker",
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: [],
      };

      const result = appendAttackNarration(save, null, defender, checkResult);

      expect(result).toBe(save);
    });

    it("should return save unchanged when defender is null", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({ id: "attacker" });
      const save = makeTestSave(storyPack, attacker);
      const checkResult: CheckResult = {
        checkId: "test",
        actorId: attacker.id,
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: [],
      };

      const result = appendAttackNarration(save, attacker, null, checkResult);

      expect(result).toBe(save);
    });

    it("should add parry narration on miss with parry defense", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({ id: "attacker", name: "Attacker" });
      const defender = makeTestActor({ id: "defender", name: "Defender" });
      const save = makeTestSave(storyPack, attacker);
      const checkResult: CheckResult = {
        checkId: "test",
        actorId: attacker.id,
        roll: 50,
        target: 40,
        success: false,
        dos: 0,
        dof: 10,
        critical: "none",
        tags: ["combat:defense=parry"],
      };

      const result = appendAttackNarration(save, attacker, defender, checkResult);

      expect(result.runtime.combatLog).toBeDefined();
      expect(result.runtime.combatLog?.[0]).toContain("Defender para il colpo");
    });

    it("should add dodge narration on miss with dodge defense", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({ id: "attacker", name: "Attacker" });
      const defender = makeTestActor({ id: "defender", name: "Defender" });
      const save = makeTestSave(storyPack, attacker);
      const checkResult: CheckResult = {
        checkId: "test",
        actorId: attacker.id,
        roll: 50,
        target: 40,
        success: false,
        dos: 0,
        dof: 10,
        critical: "none",
        tags: ["combat:defense=dodge"],
      };

      const result = appendAttackNarration(save, attacker, defender, checkResult);

      expect(result.runtime.combatLog).toBeDefined();
      expect(result.runtime.combatLog?.[0]).toContain("Defender schiva il colpo");
    });

    it("should add miss narration when no defense tag", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({ id: "attacker", name: "Attacker", kind: "PC" });
      const defender = makeTestActor({ id: "defender", name: "Defender" });
      const save = makeTestSave(storyPack, attacker);
      const checkResult: CheckResult = {
        checkId: "test",
        actorId: attacker.id,
        roll: 50,
        target: 40,
        success: false,
        dos: 0,
        dof: 10,
        critical: "none",
        tags: [],
      };

      const result = appendAttackNarration(save, attacker, defender, checkResult);

      expect(result.runtime.combatLog).toBeDefined();
      expect(result.runtime.combatLog?.[0]).toContain("Il tuo attacco manca il bersaglio");
    });

    it("should add miss narration for NPC attacker", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({ id: "attacker", name: "Attacker", kind: "NPC" });
      const defender = makeTestActor({ id: "defender", name: "Defender" });
      const save = makeTestSave(storyPack, defender);
      const checkResult: CheckResult = {
        checkId: "test",
        actorId: attacker.id,
        roll: 50,
        target: 40,
        success: false,
        dos: 0,
        dof: 10,
        critical: "none",
        tags: [],
      };

      const result = appendAttackNarration(save, attacker, defender, checkResult);

      expect(result.runtime.combatLog).toBeDefined();
      expect(result.runtime.combatLog?.[0]).toContain("Attacker manca il colpo");
    });

    it("should add stance narration on hit with defend stance", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({ id: "attacker" });
      const defender = makeTestActor({ id: "defender" });
      const save = makeTestSave(storyPack, attacker);
      const checkResult: CheckResult = {
        checkId: "test",
        actorId: attacker.id,
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: ["combat:defenderStance=defend"],
      };

      const result = appendAttackNarration(save, attacker, defender, checkResult);

      expect(result.runtime.combatLog).toBeDefined();
      expect(result.runtime.combatLog?.[0]).toContain("Il bersaglio è in difesa");
    });

    it("should add stance narration on miss with defend stance", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({ id: "attacker" });
      const defender = makeTestActor({ id: "defender" });
      const save = makeTestSave(storyPack, attacker);
      const checkResult: CheckResult = {
        checkId: "test",
        actorId: attacker.id,
        roll: 50,
        target: 40,
        success: false,
        dos: 0,
        dof: 10,
        critical: "none",
        tags: ["combat:defenderStance=defend"],
      };

      const result = appendAttackNarration(save, attacker, defender, checkResult);

      expect(result.runtime.combatLog).toBeDefined();
      const log = result.runtime.combatLog || [];
      expect(log.some((entry) => entry.includes("Il bersaglio è in difesa"))).toBe(true);
    });

    it("should avoid duplicate stance messages", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({ id: "attacker" });
      const defender = makeTestActor({ id: "defender" });
      const stanceMessage = "Il bersaglio è in difesa: è più difficile colpirlo.";
      const save = {
        ...makeTestSave(storyPack, attacker),
        runtime: {
          ...makeTestSave(storyPack, attacker).runtime,
          combatLog: [stanceMessage],
        },
      };
      const checkResult: CheckResult = {
        checkId: "test",
        actorId: attacker.id,
        roll: 30,
        target: 40,
        success: true,
        dos: 10,
        dof: 0,
        critical: "none",
        tags: ["combat:defenderStance=defend"],
      };

      const result = appendAttackNarration(save, attacker, defender, checkResult);

      // Should not add duplicate stance message
      const stanceCount = (result.runtime.combatLog || []).filter((entry) => entry === stanceMessage).length;
      expect(stanceCount).toBe(1);
    });

    it("should use default name when defender has no name", () => {
      const storyPack = makeTestStoryPack();
      const attacker = makeTestActor({ id: "attacker", name: "Attacker" });
      const defender = makeTestActor({ id: "defender", name: undefined });
      const save = makeTestSave(storyPack, attacker);
      const checkResult: CheckResult = {
        checkId: "test",
        actorId: attacker.id,
        roll: 50,
        target: 40,
        success: false,
        dos: 0,
        dof: 10,
        critical: "none",
        tags: ["combat:defense=parry"],
      };

      const result = appendAttackNarration(save, attacker, defender, checkResult);

      expect(result.runtime.combatLog).toBeDefined();
      expect(result.runtime.combatLog?.[0]).toContain("il bersaglio para il colpo");
    });
  });
});
