import { describe, it, expect } from "vitest";
import type { CombatAttackCheck, CheckResult, Weapon, Armor, CombatState, ActorId } from "../types";
import { makeTestActor } from "../test-helpers/makeTestActor";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { FakeRng } from "../test-helpers/fakeRng";
import { computeAttackTarget, performCombatAttackCheck } from "../checks";
import { applyCombatDamageIfHit } from "./damage";

function makeCombatState(participants: ActorId[], stancesByActorId?: Record<ActorId, "defend" | "allOut" | "aim">): CombatState {
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
    stancesByActorId,
    turnCounter: 0,
  };
}

describe("weapon qualities", () => {
  it("accurate aim adds +10 to hit and extra damage dice", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker", stats: { BS: 50 } });
    const defender = makeTestActor({ id: "defender", stats: { TOU: 0 } });
    const weapon: Weapon = {
      id: "rifle",
      name: "Rifle",
      kind: "RANGED",
      damage: { tier: "single", add: 0 },
      damageType: "piercing",
      penetration: 0,
      qualities: [{ id: "accurate" }],
    };

    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      weaponsById: { rifle: weapon },
      runtime: {
        ...save.runtime,
        combat: makeCombatState([attacker.id, defender.id], { [attacker.id]: "aim" }),
      },
    };

    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "RANGED", weaponId: "rifle" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: true, allowDodge: true, strategy: "autoBest" },
    };

    const target = computeAttackTarget(check, attacker, defender, saveWithBoth, storyPack);
    expect(target.modifier).toBe(30);

    const d100For4 = FakeRng.d100ForNextInt(4, 1, 10);
    const d100For7 = FakeRng.d100ForNextInt(7, 1, 10);
    const d100For9 = FakeRng.d100ForNextInt(9, 1, 10);
    const rng = new FakeRng([d100For4, d100For7, d100For9]);

    const hitResult: CheckResult = {
      checkId: "test_attack",
      actorId: attacker.id,
      roll: 10,
      target: 80,
      success: true,
      dos: 4,
      dof: 0,
      critical: "none",
      tags: [],
    };

    const damageResult = applyCombatDamageIfHit(check, hitResult, saveWithBoth, rng, storyPack);
    const damageLog = damageResult.save.runtime.runtimeLog ?? [];
    expect(damageLog.some((entry) => entry.kind === "system" && entry.message.includes("Accurate: +2d10"))).toBe(true);
  });

  it("flexible attacks cannot be parried", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker" });
    const defender = makeTestActor({ id: "defender" });
    const flexibleWeapon: Weapon = {
      id: "whip",
      name: "Whip",
      kind: "MELEE",
      damage: { tier: "single", add: 0, bonus: "SB" },
      damageType: "impact",
      penetration: 0,
      qualities: [{ id: "flexible" }],
    };
    const parryWeapon: Weapon = {
      id: "sword",
      name: "Sword",
      kind: "MELEE",
      damage: { tier: "single", add: 0, bonus: "SB" },
      damageType: "impact",
      penetration: 0,
    };

    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: { ...defender, equipment: { ...defender.equipment, mainHand: { kind: "weapon", id: "sword" } } },
      },
      weaponsById: { whip: flexibleWeapon, sword: parryWeapon },
      runtime: {
        ...save.runtime,
        combat: makeCombatState([attacker.id, defender.id]),
      },
    };

    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE", weaponId: "whip" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: true, allowDodge: true, strategy: "preferParry" },
    };

    const rng = new FakeRng([10, 20]);
    const { result } = performCombatAttackCheck(check, storyPack, saveWithBoth, rng);
    expect(result?.tags).toContain("combat:defense=dodge");
  });

  it("unwieldy weapons cannot be used to parry", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker" });
    const defender = makeTestActor({ id: "defender" });
    const unwieldyWeapon: Weapon = {
      id: "maul",
      name: "Maul",
      kind: "MELEE",
      damage: { tier: "double", add: 0, bonus: "SB" },
      damageType: "impact",
      penetration: 0,
      qualities: [{ id: "unwieldy" }],
    };

    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: { ...defender, equipment: { ...defender.equipment, mainHand: { kind: "weapon", id: "maul" } } },
      },
      weaponsById: { maul: unwieldyWeapon },
      runtime: {
        ...save.runtime,
        combat: makeCombatState([attacker.id, defender.id]),
      },
    };

    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE", weaponId: "maul" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: true, allowDodge: true, strategy: "preferParry" },
    };

    const rng = new FakeRng([10, 20]);
    const { result } = performCombatAttackCheck(check, storyPack, saveWithBoth, rng);
    expect(result?.tags).toContain("combat:defense:parryBlocked=unwieldy");
  });

  it("razor sharp doubles penetration when DoS >= 3", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker", stats: { STR: 0 } });
    const defender = makeTestActor({
      id: "defender",
      stats: { TOU: 0 },
      equipment: { ...makeTestActor().equipment, armor: { kind: "armor", id: "plate" } },
    });
    const weapon: Weapon = {
      id: "blade",
      name: "Blade",
      kind: "MELEE",
      damage: { tier: "single", add: 0, bonus: "SB" },
      damageType: "rendering",
      penetration: 2,
      qualities: [{ id: "razor_sharp" }],
    };
    const armor: Armor = { id: "plate", name: "Plate", soak: 6, weight: 10 };

    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      weaponsById: { blade: weapon },
      armorsById: { plate: armor },
      runtime: {
        ...save.runtime,
        combat: makeCombatState([attacker.id, defender.id]),
      },
    };

    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE", weaponId: "blade" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: true, allowDodge: true, strategy: "autoBest" },
    };

    const d100For8 = FakeRng.d100ForNextInt(8, 1, 10);
    const rng = new FakeRng([d100For8]);
    const hitResult: CheckResult = {
      checkId: "test_attack",
      actorId: attacker.id,
      roll: 10,
      target: 60,
      success: true,
      dos: 3,
      dof: 0,
      critical: "none",
      tags: [],
    };

    const damageResult = applyCombatDamageIfHit(check, hitResult, saveWithBoth, rng, storyPack);
    expect(damageResult.finalDamage).toBe(6);
  });

  it("magic field parry can destroy the attacking weapon", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({
      id: "attacker",
      equipment: { ...makeTestActor().equipment, mainHand: { kind: "weapon", id: "sword" } },
    });
    const defender = makeTestActor({
      id: "defender",
      equipment: { ...makeTestActor().equipment, mainHand: { kind: "weapon", id: "warding_blade" } },
    });
    const attackerWeapon: Weapon = {
      id: "sword",
      name: "Sword",
      kind: "MELEE",
      damage: { tier: "single", add: 0, bonus: "SB" },
      damageType: "impact",
      penetration: 0,
    };
    const parryWeapon: Weapon = {
      id: "warding_blade",
      name: "Warding Blade",
      kind: "MELEE",
      damage: { tier: "single", add: 0, bonus: "SB" },
      damageType: "impact",
      penetration: 0,
      qualities: [{ id: "magic_field" }],
    };

    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      weaponsById: { sword: attackerWeapon, warding_blade: parryWeapon },
      runtime: {
        ...save.runtime,
        combat: makeCombatState([attacker.id, defender.id]),
      },
    };

    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE", weaponId: "sword" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: true, allowDodge: false, strategy: "preferParry" },
    };

    const rng = new FakeRng([40, 10, 25]);
    const { save: afterCheck } = performCombatAttackCheck(check, storyPack, saveWithBoth, rng);
    expect(afterCheck.actorsById[attacker.id].equipment?.mainHand).toBeNull();
    const runtimeLog = afterCheck.runtime.runtimeLog ?? [];
    expect(runtimeLog.some((entry) => entry.kind === "system" && entry.tags?.includes("weapon:magicField"))).toBe(true);
  });
});
