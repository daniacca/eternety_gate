import type { CombatAttackCheck, CheckResult, Weapon } from "./types";
import { applyCombatDamageIfHit } from "./combat/damage";
import { performCheckWithSave } from "./checks";
import { FakeRng } from "./test-helpers/fakeRng";
import { makeTestActor } from "./test-helpers/makeTestActor";
import { makeTestSave } from "./test-helpers/makeTestSave";
import { makeTestStoryPack } from "./test-helpers/makeTestStoryPack";

describe("fate points", () => {
  it("rerolls failed checks when fate protection is active", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({
      stats: { STR: 30 },
      resources: { wounds: 0, rf: 0, fatePoints: 1, fateProtectionActive: true },
    });
    const save = makeTestSave(storyPack, actor);
    const rng = new FakeRng([90, 10]);

    const check = {
      id: "fate:check",
      kind: "single",
      actorRef: { mode: "byId", actorId: actor.id },
      key: "STR",
      difficulty: "Challenging",
    } as const;

    const outcome = performCheckWithSave(check, storyPack, save, rng);
    const result = outcome.result;

    expect(result?.success).toBe(true);
    expect(result?.tags).toContain("fate:reroll=1");
    expect(result?.tags).toContain("fate:rerollFrom=90");
    expect(outcome.save.actorsById[actor.id].resources.fatePoints).toBe(0);
    expect(outcome.save.actorsById[actor.id].resources.fateProtectionActive).toBe(false);
  });

  it("rerolls damage roll of 1 when fate protection is active", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({
      id: "PC_1",
      stats: { STR: 0, BS: 30 },
      resources: { wounds: 0, rf: 0, fatePoints: 1, fateProtectionActive: true },
    });
    const defender = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { TOU: 0 },
      resources: { wounds: 0, rf: 0 },
    });

    const baseSave = makeTestSave(storyPack, attacker);
    const weapon: Weapon = {
      id: "test_bow",
      name: "Test Bow",
      kind: "RANGED",
      damage: { tier: "single", add: 0 },
      damageType: "piercing",
      penetration: 0,
      range: 8,
    };

    const save = {
      ...baseSave,
      actorsById: {
        ...baseSave.actorsById,
        [defender.id]: defender,
      },
      weaponsById: {
        ...(baseSave.weaponsById ?? {}),
        [weapon.id]: weapon,
      },
    };

    const check: CombatAttackCheck = {
      id: "combat:fate:attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "RANGED", weaponId: weapon.id },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: false, allowDodge: false, strategy: "autoBest" },
    };

    const result: CheckResult = {
      checkId: check.id,
      actorId: attacker.id,
      roll: 10,
      target: 30,
      success: true,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: [],
    };

    const rng = new FakeRng([
      FakeRng.d100ForNextInt(1, 1, 10),
      FakeRng.d100ForNextInt(7, 1, 10),
    ]);

    const damageOutcome = applyCombatDamageIfHit(check, result, save, rng, storyPack);
    expect(damageOutcome.finalDamage).toBe(7);
    expect(damageOutcome.save.actorsById[attacker.id].resources.fatePoints).toBe(0);
    expect(damageOutcome.save.actorsById[attacker.id].resources.fateProtectionActive).toBe(false);
  });
});
