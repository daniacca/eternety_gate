import { describe, it, expect } from "vitest";
import type { CombatAttackCheck, CheckResult, Weapon, Armor, CombatState, ActorId } from "../types";
import { makeTestActor } from "../test-helpers/makeTestActor";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { FakeRng } from "../test-helpers/fakeRng";
import { computeAttackTarget, performCombatAttackCheck } from "../checks/combat";
import { applyCombatDamageIfHit } from "./damage";
import { calculateWeaponDamage } from "./equipment";

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
        [defender.id]: { ...defender, equipment: { ...defender.equipment, mainHand: { kind: "weapon" as const, id: "sword" } } },
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

  it("magic fueled uses WIL and applies non-weaver penalty", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker", stats: { WIL: 60, BS: 80 } });
    const defender = makeTestActor({ id: "defender" });
    const magicFueledWeapon: Weapon = {
      id: "gauntlet",
      name: "Gauntlet",
      kind: "RANGED",
      damage: { tier: "single", add: 0 },
      damageType: "energy",
      penetration: 0,
      range: 10,
      qualities: [{ id: "magic_fueled", rank: 2 }],
    };

    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      weaponsById: { gauntlet: magicFueledWeapon },
      runtime: {
        ...save.runtime,
        combat: makeCombatState([attacker.id, defender.id]),
      },
    };

    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "RANGED", weaponId: "gauntlet" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: true, allowDodge: true, strategy: "autoBest" },
    };

    const rng = new FakeRng([10, 100]);
    const { result } = performCombatAttackCheck(check, storyPack, saveWithBoth, rng);
    expect(result?.tags).toContain("combat:attackStat=WIL");
    expect(result?.tags).toContain("combat:mod:magicFueled=nonWeaver:-10");
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
        [defender.id]: { ...defender, equipment: { ...defender.equipment, mainHand: { kind: "weapon" as const, id: "maul" } } },
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

  it("primitive caps damage dice roll before bonuses", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker" });
    const primitiveWeapon: Weapon = {
      id: "rusty_rifle",
      name: "Rusty Rifle",
      kind: "RANGED",
      damage: { tier: "single", add: 2 },
      damageType: "piercing",
      penetration: 0,
      qualities: [{ id: "primitive", rank: 7 }],
    };
    const save = makeTestSave(storyPack, attacker);
    const saveWithWeapon = {
      ...save,
      weaponsById: { rusty_rifle: primitiveWeapon },
    };
    const roll9 = FakeRng.d100ForNextInt(9, 1, 10);
    const rng = new FakeRng([roll9]);
    const damage = calculateWeaponDamage(saveWithWeapon, attacker, "rusty_rifle", rng, "RANGED");
    expect(damage.rawDamage).toBe(9); // clamped to 7 + add 2
  });

  it("proven raises damage dice roll floor before bonuses", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker" });
    const provenWeapon: Weapon = {
      id: "master_rifle",
      name: "Master Rifle",
      kind: "RANGED",
      damage: { tier: "single", add: 2 },
      damageType: "piercing",
      penetration: 0,
      qualities: [{ id: "proven", rank: 3 }],
    };
    const save = makeTestSave(storyPack, attacker);
    const saveWithWeapon = {
      ...save,
      weaponsById: { master_rifle: provenWeapon },
    };
    const roll1 = FakeRng.d100ForNextInt(1, 1, 10);
    const rng = new FakeRng([roll1]);
    const damage = calculateWeaponDamage(saveWithWeapon, attacker, "master_rifle", rng, "RANGED");
    expect(damage.rawDamage).toBe(5); // floor to 3 + add 2
  });
});

describe("defense selection", () => {
  const baseWeapon: Weapon = {
    id: "club",
    name: "Club",
    kind: "MELEE",
    damage: { tier: "single", add: 0, bonus: "SB" },
    damageType: "impact",
    penetration: 0,
  };

  const flexibleWeapon: Weapon = {
    id: "whip",
    name: "Whip",
    kind: "MELEE",
    damage: { tier: "single", add: 0, bonus: "SB" },
    damageType: "impact",
    penetration: 0,
    qualities: [{ id: "flexible" }],
  };

  const buildSave = (storyPack: any, attacker: any, defender: any, weaponsById: Record<string, Weapon>) => {
    const save = makeTestSave(storyPack, attacker);
    return {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      weaponsById,
      runtime: {
        ...save.runtime,
        combat: makeCombatState([attacker.id, defender.id]),
      },
    };
  };

  it("prefers parry when parry chance is higher", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker", stats: { WS: 70 } });
    const defender = makeTestActor({
      id: "defender",
      stats: { WS: 60, AGI: 30 },
      skills: { "skill:parry": 2, "skill:dodge": 1 },
      equipment: { mainHand: { kind: "weapon", id: "club" } },
    });
    const save = buildSave(storyPack, attacker, defender, { club: baseWeapon });
    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE", weaponId: "club" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: true, allowDodge: true, strategy: "autoBest" },
    };
    const rng = new FakeRng([10, 10]);
    const { result } = performCombatAttackCheck(check, storyPack, save, rng);
    expect(result?.tags).toContain("combat:defense=parry");
  });

  it("prefers dodge when dodge chance is higher", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker", stats: { WS: 70 } });
    const defender = makeTestActor({
      id: "defender",
      stats: { WS: 30, AGI: 70 },
      skills: { "skill:parry": 1, "skill:dodge": 2 },
      equipment: { mainHand: { kind: "weapon", id: "club" } },
    });
    const save = buildSave(storyPack, attacker, defender, { club: baseWeapon });
    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE", weaponId: "club" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: true, allowDodge: true, strategy: "autoBest" },
    };
    const rng = new FakeRng([10, 10]);
    const { result } = performCombatAttackCheck(check, storyPack, save, rng);
    expect(result?.tags).toContain("combat:defense=dodge");
  });

  it("takes damage when both parry and dodge are unavailable", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker", stats: { WS: 70 } });
    const defender = makeTestActor({ id: "defender", resources: { wounds: 0, rf: 0 } });
    const save = buildSave(storyPack, attacker, defender, { club: baseWeapon });
    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE", weaponId: "club" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: false, allowDodge: false, strategy: "autoBest" },
    };
    const attackRng = new FakeRng([10]);
    const { result } = performCombatAttackCheck(check, storyPack, save, attackRng);
    expect(result?.tags).toContain("combat:defense=none");
    const damageRng = new FakeRng([50]);
    const { save: afterDamage } = applyCombatDamageIfHit(check, result, save, damageRng, storyPack);
    expect(afterDamage.actorsById[defender.id].resources.wounds).toBeGreaterThan(0);
  });

  it("tries to dodge when parry is not possible but dodge is available", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker", stats: { WS: 70 } });
    const defender = makeTestActor({
      id: "defender",
      stats: { AGI: 60 },
      skills: { "skill:dodge": 1 },
      equipment: { mainHand: { kind: "weapon", id: "club" } },
    });
    const save = buildSave(storyPack, attacker, defender, { club: baseWeapon, whip: flexibleWeapon });
    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE", weaponId: "whip" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: true, allowDodge: true, strategy: "autoBest" },
    };
    const rng = new FakeRng([10, 10]);
    const { result } = performCombatAttackCheck(check, storyPack, save, rng);
    expect(result?.tags).toContain("combat:defense=dodge");
  });

  it("tries to parry when dodge is not available", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "attacker", stats: { WS: 70 } });
    const defender = makeTestActor({
      id: "defender",
      stats: { WS: 60 },
      skills: { "skill:parry": 1 },
      equipment: { mainHand: { kind: "weapon", id: "club" } },
    });
    const save = buildSave(storyPack, attacker, defender, { club: baseWeapon });
    const check: CombatAttackCheck = {
      id: "test_attack",
      kind: "combatAttack",
      attacker: { actorRef: { mode: "byId", actorId: attacker.id }, mode: "MELEE", weaponId: "club" },
      defender: { actorRef: { mode: "byId", actorId: defender.id } },
      defense: { allowParry: true, allowDodge: false, strategy: "autoBest" },
    };
    const rng = new FakeRng([10, 10]);
    const { result } = performCombatAttackCheck(check, storyPack, save, rng);
    expect(result?.tags).toContain("combat:defense=parry");
  });
});
