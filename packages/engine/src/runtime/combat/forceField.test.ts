import { describe, it, expect } from "vitest";
import type { CombatAttackCheck, CombatState, ActorId, Weapon } from "../types";
import { makeTestActor } from "../test-helpers/makeTestActor";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { FakeRng } from "../test-helpers/fakeRng";
import { performCombatAttackCheck } from "../checks/combat";

function makeCombatState(participants: ActorId[]): CombatState {
  const positions = participants.reduce<Record<ActorId, { x: number; y: number }>>((acc, id, index) => {
    acc[id] = { x: index, y: 0 };
    return acc;
  }, {});
  return {
    active: true,
    participants,
    currentIndex: 0,
    round: 1,
    grid: { width: 5, height: 5 },
    positions,
    turn: { moveRemaining: 3, actionAvailable: true },
    turnCounter: 0,
  };
}

const baseWeapon: Weapon = {
  id: "club",
  name: "Club",
  kind: "MELEE",
  damage: { tier: "single", add: 0, bonus: "SB" },
  damageType: "impact",
  penetration: 0,
};

describe("force field", () => {
  it("blocks attacks before defense", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker", stats: { WS: 70 } });
    const defender = makeTestActor({
      id: "defender",
      traits: { "trait:force_field": { x: 40, y: 5 } },
    });
    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      weaponsById: { club: baseWeapon },
      runtime: {
        ...save.runtime,
        combat: makeCombatState([attacker.id, defender.id]),
      },
    };

    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE", weaponId: "club" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: true, allowDodge: true, strategy: "autoBest" },
    };

    const rng = new FakeRng([10, 30]); // hit, force field block
    const { result } = performCombatAttackCheck(check, storyPack, saveWithBoth, rng);

    expect(result?.success).toBe(false);
    expect(result?.tags).toContain("combat:blocked=forceField");
    expect(result?.tags).toContain("combat:forceField:roll=30");
  });

  it("overloads and applies fatigue when roll is within overload range", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker", stats: { WS: 70 } });
    const defender = makeTestActor({
      id: "defender",
      resources: { wounds: 0, rf: 0 },
      traits: { "trait:force_field": { x: 40, y: 10 } },
    });
    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      weaponsById: { club: baseWeapon },
      runtime: {
        ...save.runtime,
        combat: makeCombatState([attacker.id, defender.id]),
      },
    };

    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE", weaponId: "club" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: true, allowDodge: true, strategy: "autoBest" },
    };

    const fatigueRoll = FakeRng.d100ForNextInt(7, 1, 10);
    const rng = new FakeRng([10, 5, fatigueRoll]); // hit, overload, fatigue
    const { result, save: afterCheck } = performCombatAttackCheck(check, storyPack, saveWithBoth, rng);

    expect(result?.success).toBe(false);
    expect(result?.tags).toContain("combat:blocked=forceField");
    expect(result?.tags).toContain("combat:forceField:overloaded=1");
    expect(afterCheck.actorsById[defender.id].resources.rf).toBe(7);
    expect(afterCheck.actorsById[defender.id].conditions?.force_field_overload?.untilTurnCounter).toBe(5);
  });
});
