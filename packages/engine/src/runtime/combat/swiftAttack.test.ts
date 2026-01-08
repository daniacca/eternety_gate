import { describe, it, expect } from "vitest";
import type { GameSave, StoryPack, Effect } from "../types";
import { combatSwiftAttack } from "./actions";
import { FakeRng } from "../test-helpers/fakeRng";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import type { CharacterCatalogs, Talent } from "../../content/catalogs";

describe("combatSwiftAttack", () => {
  const createStoryPackWithCatalogs = (): StoryPack & { talents: Talent[] } => {
    const basePack = makeTestStoryPack();
    const swiftAttackTalent: Talent = {
      id: "talent:swift_attack",
      name: "Attacco Rapido",
      tier: 2,
      xpCost: 1000,
      prerequisites: [{ type: "statAtLeast", stat: "WS", value: 40 }],
      grants: [{ type: "unlockAction", actionId: "combat:swiftAttack" }],
      maxRank: 1,
    };
    return {
      ...basePack,
      talents: [swiftAttackTalent],
    };
  };

  it("should block Swift Attack if action is not unlocked", () => {
    const storyPack = createStoryPackWithCatalogs();
    const attacker = makeTestActor({
      id: "PC_1",
      stats: { WS: 50 },
      talents: {}, // No swift attack talent
    });
    const defender = makeTestActor({ id: "NPC_1" });
    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      runtime: {
        ...save.runtime,
        combat: {
          active: true,
          participants: ["PC_1", "NPC_1"],
          positions: { PC_1: { x: 0, y: 0 }, NPC_1: { x: 1, y: 0 } },
          currentIndex: 0,
          round: 1,
          turnCounter: 0,
          turn: { actionAvailable: true, moveRemaining: 3 },
          grid: { width: 10, height: 10 },
        },
      },
    };

    const effect: Effect = {
      op: "combatSwiftAttack",
      attackerId: "PC_1",
      defenderId: "NPC_1",
    };

    const rng = new FakeRng([50, 60]); // Attacker roll 50, defender roll 60
    const result = combatSwiftAttack(effect as any, storyPack, saveWithBoth, rng);

    expect(result.save.runtime.lastCheck).toBeDefined();
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:blocked=actionNotUnlocked");
  });

  it("should block Swift Attack if action is not available", () => {
    const storyPack = createStoryPackWithCatalogs();
    const attacker = makeTestActor({
      id: "PC_1",
      stats: { WS: 50 },
      talents: { "talent:swift_attack": 1 },
    });
    const defender = makeTestActor({ id: "NPC_1" });
    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      runtime: {
        ...save.runtime,
        combat: {
          active: true,
          participants: ["PC_1", "NPC_1"],
          positions: { PC_1: { x: 0, y: 0 }, NPC_1: { x: 1, y: 0 } },
          currentIndex: 0,
          round: 1,
          turnCounter: 0,
          turn: { actionAvailable: false, moveRemaining: 3 },
          grid: { width: 10, height: 10 },
        },
      },
    };

    const effect: Effect = {
      op: "combatSwiftAttack",
      attackerId: "PC_1",
      defenderId: "NPC_1",
    };

    const rng = new FakeRng([50, 60]);
    const result = combatSwiftAttack(effect as any, storyPack, saveWithBoth, rng);

    expect(result.save.runtime.lastCheck).toBeDefined();
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:blocked=noAction");
  });

  it("should block Swift Attack if not in melee range", () => {
    const storyPack = createStoryPackWithCatalogs();
    const attacker = makeTestActor({
      id: "PC_1",
      stats: { WS: 50 },
      talents: { "talent:swift_attack": 1 },
    });
    const defender = makeTestActor({ id: "NPC_1" });
    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      runtime: {
        ...save.runtime,
        combat: {
          active: true,
          participants: ["PC_1", "NPC_1"],
          positions: { PC_1: { x: 0, y: 0 }, NPC_1: { x: 3, y: 0 } }, // Distance > 1
          currentIndex: 0,
          round: 1,
          turnCounter: 0,
          turn: { actionAvailable: true, moveRemaining: 3 },
          grid: { width: 10, height: 10 },
        },
      },
    };

    const effect: Effect = {
      op: "combatSwiftAttack",
      attackerId: "PC_1",
      defenderId: "NPC_1",
    };

    const rng = new FakeRng([50, 60]);
    const result = combatSwiftAttack(effect as any, storyPack, saveWithBoth, rng);

    expect(result.save.runtime.lastCheck).toBeDefined();
    expect(result.save.runtime.lastCheck?.tags.some((t) => t.startsWith("combat:blocked=notInMelee"))).toBe(true);
  });

  it("should consume action and all movement", () => {
    const storyPack = createStoryPackWithCatalogs();
    const attacker = makeTestActor({
      id: "PC_1",
      stats: { WS: 50 },
      talents: { "talent:swift_attack": 1 },
    });
    const defender = makeTestActor({ id: "NPC_1", stats: { WS: 30, AGI: 30 } });
    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      runtime: {
        ...save.runtime,
        combat: {
          active: true,
          participants: ["PC_1", "NPC_1"],
          positions: { PC_1: { x: 0, y: 0 }, NPC_1: { x: 1, y: 0 } },
          currentIndex: 0,
          round: 1,
          turnCounter: 0,
          turn: { actionAvailable: true, moveRemaining: 5 },
          grid: { width: 10, height: 10 },
        },
      },
    };

    const effect: Effect = {
      op: "combatSwiftAttack",
      attackerId: "PC_1",
      defenderId: "NPC_1",
    };

    // Attacker WS 50, roll 10 => DoS 4
    // Defender WS 30, roll 30 => DoS 0 (fail)
    // Attacker wins with DoS 4, but we're just testing consumption
    // Need rolls for: attack check (2), then damage if succeeds (4 hits * 1d10 each = 4 rolls), plus soak
    const rng = new FakeRng([10, 30, 5, 5, 5, 5, 1, 1, 1, 1]); // Attack, then 4 damage rolls, then soak
    const result = combatSwiftAttack(effect as any, storyPack, saveWithBoth, rng);

    expect(result.save.runtime.combat?.turn.actionAvailable).toBe(false);
    expect(result.save.runtime.combat?.turn.moveRemaining).toBe(0);
  });

  it("should apply damage once per DoS when attack succeeds", () => {
    const storyPack = createStoryPackWithCatalogs();
    const attacker = makeTestActor({
      id: "PC_1",
      stats: { WS: 50, STR: 50 },
      talents: { "talent:swift_attack": 1 },
      equipment: { mainHand: { kind: "weapon", id: "sword" } },
    });
    const defender = makeTestActor({
      id: "NPC_1",
      stats: { WS: 30, AGI: 30, TOU: 40 },
      resources: { hp: 100, rf: 0, peq: 3 },
    });
    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      weaponsById: {
        ...save.weaponsById,
        sword: { id: "sword", name: "Spada", kind: "MELEE" as const, damage: { tier: "single" as const, add: 0 }, damageType: "impact" as const, penetration: 1 },
      },
      runtime: {
        ...save.runtime,
        combat: {
          active: true,
          participants: ["PC_1", "NPC_1"],
          positions: { PC_1: { x: 0, y: 0 }, NPC_1: { x: 1, y: 0 } },
          currentIndex: 0,
          round: 1,
          turnCounter: 0,
          turn: { actionAvailable: true, moveRemaining: 3 },
          grid: { width: 10, height: 10 },
        },
      },
    };

    const effect: Effect = {
      op: "combatSwiftAttack",
      attackerId: "PC_1",
      defenderId: "NPC_1",
    };

    // Attacker WS 50, roll 10 => DoS 4
    // Defender WS 30, roll 30 => DoS 0 (fail)
    // Attacker wins with DoS 4, should apply damage 4 times
    // For damage: weapon 1d10 + STR bonus 5 = 1d10+5 per hit
    // Using deterministic rolls: [10, 30] for attack check, then 4 damage rolls (1d10 each)
    const rng = new FakeRng([10, 30, 5, 6, 7, 8, 1, 1, 1, 1]); // Attack rolls, then 4 damage rolls (d10), then soak rolls
    const result = combatSwiftAttack(effect as any, storyPack, saveWithBoth, rng);

    expect(result.save.runtime.lastCheck?.success).toBe(true);
    expect(result.save.runtime.lastCheck?.dos).toBe(4);

    // Check that damage was applied (defender HP should be reduced)
    // Each hit: 1d10+5, with rolls 5,6,7,8 => damage 10,11,12,13 = 46 total
    // Defender starts at 100 HP, should have ~54 HP remaining (accounting for armor soak)
    const finalDefender = result.save.actorsById["NPC_1"];
    expect(finalDefender).toBeDefined();
    // HP should be reduced (exact amount depends on armor soak)
    expect(finalDefender.resources.hp).toBeLessThan(100);
  });

  it("should not apply damage if attack fails", () => {
    const storyPack = createStoryPackWithCatalogs();
    const attacker = makeTestActor({
      id: "PC_1",
      stats: { WS: 30 },
      talents: { "talent:swift_attack": 1 },
    });
    const defender = makeTestActor({
      id: "NPC_1",
      stats: { WS: 50, AGI: 50 },
      resources: { hp: 100, rf: 0, peq: 3 },
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
        combat: {
          active: true,
          participants: ["PC_1", "NPC_1"],
          positions: { PC_1: { x: 0, y: 0 }, NPC_1: { x: 1, y: 0 } },
          currentIndex: 0,
          round: 1,
          turnCounter: 0,
          turn: { actionAvailable: true, moveRemaining: 3 },
          grid: { width: 10, height: 10 },
        },
      },
    };

    const effect: Effect = {
      op: "combatSwiftAttack",
      attackerId: "PC_1",
      defenderId: "NPC_1",
    };

    // Attacker WS 30, roll 80 => DoS 0 (fail)
    // Defender WS 50, roll 20 => DoS 3
    // Attacker fails, no damage
    const rng = new FakeRng([80, 20]);
    const result = combatSwiftAttack(effect as any, storyPack, saveWithBoth, rng);

    expect(result.save.runtime.lastCheck?.success).toBe(false);
    const finalDefender = result.save.actorsById["NPC_1"];
    expect(finalDefender.resources.hp).toBe(100); // HP unchanged
  });

  it("should apply damage based on DoS difference when both succeed", () => {
    const storyPack = createStoryPackWithCatalogs();
    const attacker = makeTestActor({
      id: "PC_1",
      stats: { WS: 50, STR: 50 },
      talents: { "talent:swift_attack": 1 },
      equipment: { mainHand: { kind: "weapon", id: "sword" } },
    });
    const defender = makeTestActor({
      id: "NPC_1",
      stats: { WS: 40, AGI: 40, TOU: 40 },
      resources: { hp: 100, rf: 0, peq: 3 },
    });
    const save = makeTestSave(storyPack, attacker);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [defender.id]: defender,
      },
      weaponsById: {
        ...save.weaponsById,
        sword: { id: "sword", name: "Spada", kind: "MELEE" as const, damage: { tier: "single" as const, add: 0 }, damageType: "impact" as const, penetration: 1 },
      },
      runtime: {
        ...save.runtime,
        combat: {
          active: true,
          participants: ["PC_1", "NPC_1"],
          positions: { PC_1: { x: 0, y: 0 }, NPC_1: { x: 1, y: 0 } },
          currentIndex: 0,
          round: 1,
          turnCounter: 0,
          turn: { actionAvailable: true, moveRemaining: 3 },
          grid: { width: 10, height: 10 },
        },
      },
    };

    const effect: Effect = {
      op: "combatSwiftAttack",
      attackerId: "PC_1",
      defenderId: "NPC_1",
    };

    // Attacker WS 50, roll 10 => DoS 4
    // Defender WS 40, roll 20 => DoS 2
    // Attacker wins with DoS 2 (4 - 2), should apply damage 2 times
    const rng = new FakeRng([10, 20, 5, 6]); // Attack rolls, then 2 damage rolls
    const result = combatSwiftAttack(effect as any, storyPack, saveWithBoth, rng);

    expect(result.save.runtime.lastCheck?.success).toBe(true);
    expect(result.save.runtime.lastCheck?.dos).toBe(2);

    const finalDefender = result.save.actorsById["NPC_1"];
    expect(finalDefender.resources.hp).toBeLessThan(100); // HP reduced
  });
});
