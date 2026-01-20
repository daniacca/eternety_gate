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
        type: "consumable",
        weight: 0.1,
        maxStack: 20,
        tags: ["ammo", "arrow"],
      },
    ],
    weapons: [
      {
        id: "bow",
        name: "Bow",
        kind: "RANGED",
        damage: { tier: "single", add: 0 },
        damageType: "piercing",
        penetration: 0,
        range: { short: 4, long: 8 },
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
          range: { short: 4, long: 8 },
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
