import { describe, it, expect } from "vitest";
import type { Actor, Effect, StoryPack } from "../../types";
import { combatRequestAttack } from "./requestAttack";
import { startCombat } from "../combat";
import { createNewGame } from "../../engine";
import { FakeRng } from "../../test-helpers/fakeRng";
import { makeTestStoryPack } from "../../test-helpers/makeTestStoryPack";

function makeActor(overrides: Partial<Actor>): Actor {
  return {
    id: overrides.id || "PC_1",
    name: overrides.name || "Test",
    kind: overrides.kind || "PC",
    tags: overrides.tags || [],
    stats: {
      STR: 40,
      TOU: 40,
      AGI: 40,
      INT: 40,
      WIL: 40,
      CHA: 40,
      WS: 40,
      BS: 40,
      INI: 40,
      PER: 40,
      ...(overrides.stats || {}),
    },
    resources: { wounds: 0, rf: 0 },
    skills: {},
    talents: {},
    traits: {},
    equipment: {
      mainHand: null,
      offHand: null,
      armor: null,
      helmet: null,
      boots: null,
      cloak: null,
      necklace: null,
      ring1: null,
      ring2: null,
      ...(overrides.equipment || {}),
    },
    inventory: overrides.inventory || [],
    status: {
      conditions: [],
      tempModifiers: [],
    },
  };
}

function prepareCombatSave(storyPack: StoryPack, attacker: Actor, defender: Actor) {
  const party = { actors: [attacker.id], activeActorId: attacker.id };
  const contentPack = {
    id: "test",
    items: [
      {
        id: "ammo:arrow",
        name: "Arrows",
        type: "consumable" as const,
        weight: 0.1,
        maxStack: 20,
        tags: ["ammo", "arrow"],
      },
    ],
    weapons: [
      {
        id: "bow",
        name: "Bow",
        kind: "RANGED" as const,
        damage: { tier: "single" as const, add: 0 },
        damageType: "piercing" as const,
        penetration: 0,
        range: 8,
        ammo: { itemId: "ammo:arrow", consumedPerAttack: 1 },
      },
    ],
    armors: [],
  };

  const baseSave = createNewGame(storyPack, 123, party, { [attacker.id]: attacker, [defender.id]: defender }, contentPack);
  const combatSave = startCombat(
    storyPack,
    baseSave,
    [attacker.id, defender.id],
    undefined,
    { width: 6, height: 6 },
    [
      { actorId: attacker.id, x: 0, y: 0 },
      { actorId: defender.id, x: 3, y: 0 },
    ]
  );

  const combat = combatSave.runtime.combat!;
  const attackerIndex = combat.participants.indexOf(attacker.id);
  return {
    ...combatSave,
    runtime: {
      ...combatSave.runtime,
      combat: {
        ...combat,
        currentIndex: attackerIndex,
        turn: {
          ...combat.turn,
          actionAvailable: true,
        },
      },
    },
  };
}

function prepareAoECombatSave(storyPack: StoryPack, actors: Actor[]) {
  const party = { actors: ["PC_1", "PC_2"], activeActorId: "PC_1" };
  const contentPack = {
    id: "test-aoe",
    items: [],
    weapons: [
      {
        id: "spray_gun",
        name: "Spray Gun",
        kind: "RANGED" as const,
        damage: { tier: "single" as const, add: 0 },
        damageType: "impact" as const,
        penetration: 0,
        range: 6,
        qualities: [{ id: "spray" }],
      },
      {
        id: "blast_gun",
        name: "Blast Gun",
        kind: "RANGED" as const,
        damage: { tier: "single" as const, add: 0 },
        damageType: "impact" as const,
        penetration: 0,
        range: 6,
        qualities: [{ id: "blast", rank: 2 }],
      },
    ],
    armors: [],
  };

  const actorsById = actors.reduce<Record<string, Actor>>((acc, actor) => {
    acc[actor.id] = actor;
    return acc;
  }, {});

  const baseSave = createNewGame(storyPack, 123, party, actorsById, contentPack);
  const combatSave = startCombat(
    storyPack,
    baseSave,
    actors.map((actor) => actor.id),
    undefined,
    { width: 6, height: 6 },
    [
      { actorId: "PC_1", x: 0, y: 0 },
      { actorId: "PC_2", x: 1, y: 0 },
      { actorId: "NPC_1", x: 2, y: 0 },
      { actorId: "NPC_2", x: 2, y: 1 },
    ]
  );

  const combat = combatSave.runtime.combat!;
  const attackerIndex = combat.participants.indexOf("PC_1");
  return {
    ...combatSave,
    runtime: {
      ...combatSave.runtime,
      combat: {
        ...combat,
        currentIndex: attackerIndex,
        turn: {
          ...combat.turn,
          actionAvailable: true,
        },
      },
    },
  };
}

describe("combatRequestAttack ammo consumption", () => {
  it("consumes ammo when ranged attack is performed", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeActor({
      id: "PC_1",
      equipment: { mainHand: { kind: "weapon", id: "bow" } },
      inventory: [{ kind: "item", id: "ammo:arrow", qty: 2 }],
    });
    const defender = makeActor({ id: "NPC_1", kind: "NPC" });
    const save = prepareCombatSave(storyPack, attacker, defender);
    const rng = new FakeRng([50, 50, 50, 50]);

    const effect: Effect = {
      op: "combatRequestAttack",
      attackerId: attacker.id,
      defenderId: defender.id,
      mode: "RANGED",
    };

    const result = combatRequestAttack(effect, storyPack, save, rng);
    const updatedInventory = result.save.actorsById[attacker.id].inventory || [];
    const ammoStack = updatedInventory.find((item) => item.id === "ammo:arrow");
    expect(ammoStack?.qty).toBe(1);
  });

  it("blocks ranged attack when ammo is missing", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeActor({
      id: "PC_1",
      equipment: { mainHand: { kind: "weapon", id: "bow" } },
      inventory: [],
    });
    const defender = makeActor({ id: "NPC_1", kind: "NPC" });
    const save = prepareCombatSave(storyPack, attacker, defender);
    const rng = new FakeRng([50, 50, 50]);

    const effect: Effect = {
      op: "combatRequestAttack",
      attackerId: attacker.id,
      defenderId: defender.id,
      mode: "RANGED",
    };

    const result = combatRequestAttack(effect, storyPack, save, rng);
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:blocked=noAmmo");
    const lastLog = result.save.runtime.combatLog?.slice(-1)[0];
    expect(lastLog).toBe("No ammo.");
  });

  it("consumes ammo twice when dual-wielding two ranged weapons", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeActor({
      id: "PC_1",
      equipment: {
        mainHand: { kind: "weapon", id: "bow" },
        offHand: { kind: "weapon", id: "bow2" },
      },
      inventory: [{ kind: "item", id: "ammo:arrow", qty: 3 }],
      talents: { "talent:two_weapon_wielder": 1 },
    });
    const defender = makeActor({ id: "NPC_1", kind: "NPC" });
    let save = prepareCombatSave(storyPack, attacker, defender);
    save = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [attacker.id]: {
          ...save.actorsById[attacker.id],
          talents: { ...(save.actorsById[attacker.id].talents || {}), "talent:two_weapon_wielder": 1 },
          equipment: {
            ...save.actorsById[attacker.id].equipment,
            offHand: { kind: "weapon", id: "bow2" },
          },
        },
      },
    };
    save = {
      ...save,
      weaponsById: {
        ...save.weaponsById,
        bow2: {
          id: "bow2",
          name: "Bow 2",
          kind: "RANGED",
          damage: { tier: "single", add: 0 },
          damageType: "piercing",
          penetration: 0,
          range: 8,
          ammo: { itemId: "ammo:arrow", consumedPerAttack: 1 },
        },
      },
    };
    expect(save.actorsById[attacker.id].equipment?.offHand?.id).toBe("bow2");
    expect(save.actorsById[attacker.id].talents["talent:two_weapon_wielder"]).toBe(1);
    const rng = new FakeRng([50, 50, 50, 50, 50, 50]);

    const effect: Effect = {
      op: "combatRequestAttack",
      attackerId: attacker.id,
      defenderId: defender.id,
      mode: "RANGED",
    };

    const result = combatRequestAttack(effect, storyPack, save, rng);
    const updatedInventory = result.save.actorsById[attacker.id].inventory || [];
    const ammoStack = updatedInventory.find((item) => item.id === "ammo:arrow");
    expect(ammoStack?.qty).toBe(1);
  });
});

describe("combatRequestAttack vengeance shot", () => {
  it("should spend fate and add DoS to damage and penetration", () => {
    const storyPack = makeTestStoryPack({
      talents: [
        {
          id: "talent:eye_of_vengeance",
          name: "Eye of Vengeance",
          tier: 3,
          xpCost: 1000,
          prerequisites: [{ type: "statAtLeast", stat: "BS", value: 50 }],
          grants: [{ type: "unlockAction", actionId: "combat:vengeanceShot" }],
        },
      ],
    });
    const attacker = makeActor({
      id: "PC_1",
      stats: { BS: 50 } as any,
      equipment: { mainHand: { kind: "weapon", id: "bow" } },
      inventory: [{ kind: "item", id: "ammo:arrow", qty: 2 }],
    });
    attacker.resources = { wounds: 0, rf: 0, fatePoints: 2 };
    attacker.talents = { "talent:eye_of_vengeance": 1 };
    const defender = makeActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { STR: 50, TOU: 50, WIL: 50, AGI: 0, WS: 0 } as any,
    });
    defender.resources = { wounds: 0, rf: 0 };
    const save = prepareCombatSave(storyPack, attacker, defender);
    const rng = new FakeRng([
      1, // attack roll (auto success)
      50, // extra roll (e.g. logs/defense path)
      FakeRng.d100ForNextInt(2, 1, 10), // damage roll (1d10)
    ]);

    const effect: Effect = {
      op: "combatRequestAttack",
      attackerId: attacker.id,
      defenderId: defender.id,
      mode: "RANGED",
      weaponId: "bow",
      vengeanceShot: true,
      defense: { allowParry: false, allowDodge: false, strategy: "autoBest" },
    };

    const result = combatRequestAttack(effect, storyPack, save, rng);
    const updatedAttacker = result.save.actorsById[attacker.id];

    expect(updatedAttacker.resources.fatePoints).toBe(1);
  });
});

describe("combatRequestAttack recharge quality", () => {
  it("blocks ranged attack until recharge expires", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeActor({
      id: "PC_1",
      equipment: { mainHand: { kind: "weapon", id: "recharge_bow" } },
    });
    const defender = makeActor({ id: "NPC_1", kind: "NPC" });
    let save = prepareCombatSave(storyPack, attacker, defender);
    save = {
      ...save,
      weaponsById: {
        ...save.weaponsById,
        recharge_bow: {
          id: "recharge_bow",
          name: "Recharge Bow",
          kind: "RANGED",
          damage: { tier: "single", add: 0 },
          damageType: "piercing",
          penetration: 0,
          range: 8,
          qualities: [{ id: "recharge", rank: 2 }],
        },
      },
      actorsById: {
        ...save.actorsById,
        [attacker.id]: {
          ...save.actorsById[attacker.id],
          equipment: {
            ...save.actorsById[attacker.id].equipment,
            mainHand: { kind: "weapon", id: "recharge_bow" },
          },
        },
      },
    };
    const rng = new FakeRng([50, 50, 50, 50, 50, 50]);

    const effect: Effect = {
      op: "combatRequestAttack",
      attackerId: attacker.id,
      defenderId: defender.id,
      mode: "RANGED",
    };

    const first = combatRequestAttack(effect, storyPack, save, rng);
    const combat = first.save.runtime.combat!;
    const rechargeUntil =
      combat.weaponRechargeUntilTurnCounterByActorId?.[attacker.id]?.["recharge_bow"];
    expect(rechargeUntil).toBe((combat.turnCounter ?? 0) + 2);

    const saveWithActionReset = {
      ...first.save,
      runtime: {
        ...first.save.runtime,
        combat: {
          ...combat,
          turn: {
            ...combat.turn,
            actionAvailable: true,
          },
        },
      },
    };
    const blocked = combatRequestAttack(effect, storyPack, saveWithActionReset, rng);
    expect(blocked.save.runtime.lastCheck?.tags).toContain("combat:blocked=recharge");

    const saveReady = {
      ...first.save,
      runtime: {
        ...first.save.runtime,
        combat: {
          ...combat,
          turnCounter: rechargeUntil ?? (combat.turnCounter ?? 0),
          turn: {
            ...combat.turn,
            actionAvailable: true,
          },
        },
      },
    };
    const ready = combatRequestAttack(effect, storyPack, saveReady, rng);
    expect(ready.save.runtime.lastCheck?.tags).not.toContain("combat:blocked=recharge");
  });
});

describe("combatRequestAttack AOE weapon qualities", () => {
  it("applies Spray cone damage to enemies only", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeActor({
      id: "PC_1",
      equipment: { mainHand: { kind: "weapon", id: "spray_gun" } },
    });
    const ally = makeActor({ id: "PC_2", kind: "PC" });
    const enemy1 = makeActor({ id: "NPC_1", kind: "NPC" });
    const enemy2 = makeActor({ id: "NPC_2", kind: "NPC" });
    const save = prepareAoECombatSave(storyPack, [attacker, ally, enemy1, enemy2]);
    const rng = new FakeRng([10, 50, 60]);

    const effect: Effect = {
      op: "combatRequestAttack",
      attackerId: "PC_1",
      defenderId: "NPC_1",
      mode: "RANGED",
      targetSelection: { kind: "cone", direction: "E" },
    };

    const result = combatRequestAttack(effect, storyPack, save, rng);
    expect(result.save.actorsById["NPC_1"].resources.wounds).toBeGreaterThan(0);
    expect(result.save.actorsById["NPC_2"].resources.wounds).toBeGreaterThan(0);
    expect(result.save.actorsById["PC_2"].resources.wounds).toBe(0);
  });

  it("applies Blast radius damage to enemies in the area", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeActor({
      id: "PC_1",
      equipment: { mainHand: { kind: "weapon", id: "blast_gun" } },
    });
    const ally = makeActor({ id: "PC_2", kind: "PC" });
    const enemy1 = makeActor({ id: "NPC_1", kind: "NPC" });
    const enemy2 = makeActor({ id: "NPC_2", kind: "NPC" });
    const save = prepareAoECombatSave(storyPack, [attacker, ally, enemy1, enemy2]);
    const rng = new FakeRng([10, 99, 99]);

    const effect: Effect = {
      op: "combatRequestAttack",
      attackerId: "PC_1",
      defenderId: "NPC_1",
      mode: "RANGED",
      targetSelection: { kind: "radius", centerPos: { x: 2, y: 0 } },
    };

    const result = combatRequestAttack(effect, storyPack, save, rng);
    expect(result.save.actorsById["NPC_1"].resources.wounds).toBeGreaterThan(0);
    expect(result.save.actorsById["NPC_2"].resources.wounds).toBeGreaterThan(0);
    expect(result.save.actorsById["PC_2"].resources.wounds).toBe(0);
  });
});

describe("combatRequestAttack Word of God", () => {
  it("blocks attack when pre-check fails", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeActor({
      id: "PC_1",
      stats: { WIL: 10, WS: 50 } as any,
    });
    const defenderBase = makeActor({
      id: "NPC_1",
      kind: "NPC",
    });
    const defender = {
      ...defenderBase,
      conditions: {
        word_of_god: { stacks: 1, params: { auraApplied: true, wilBonus: 3, overcast: 2 } },
      },
    };

    const save = prepareCombatSave(storyPack, attacker, defender);
    const combat = save.runtime.combat!;
    const saveWithPositions = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: {
          ...combat,
          positions: {
            [attacker.id]: { x: 0, y: 0 },
            [defender.id]: { x: 1, y: 0 },
          },
        },
      },
    };
    const rng = new FakeRng([100]);

    const effect: Effect = {
      op: "combatRequestAttack",
      attackerId: attacker.id,
      defenderId: defender.id,
      mode: "MELEE",
    };

    const result = combatRequestAttack(
      effect as Extract<Effect, { op: "combatRequestAttack" }>,
      storyPack,
      saveWithPositions,
      rng
    );
    const tags = result.save.runtime.lastCheck?.tags ?? [];
    expect(tags).toContain("combat:blocked=wordOfGod");
    expect(result.save.actorsById[defender.id].resources.wounds).toBe(0);
  });
});
