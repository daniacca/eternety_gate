import { describe, it, expect } from "vitest";
import { combatWhirlwindAttack } from "./whirlwindAttack";
import { makeTestStoryPack } from "../../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../../test-helpers/makeTestActor";
import { makeTestSave } from "../../test-helpers/makeTestSave";
import { startCombat } from "../combat";
import { FakeRng } from "../../test-helpers/fakeRng";
import type { Effect, Weapon } from "../../types";

describe("combatWhirlwindAttack", () => {
  it("should hit each adjacent enemy up to WS bonus", () => {
    const storyPack = makeTestStoryPack({
      talents: [
        {
          id: "talent:whirlwind_of_death",
          name: "Whirlwind of Death",
          tier: 2,
          xpCost: 500,
          prerequisites: [],
          grants: [{ type: "unlockAction", actionId: "combat:whirlwindAttack" }],
        },
      ],
    });
    const attacker = makeTestActor({
      id: "PC_1",
      stats: { WS: 56 } as any,
      talents: { "talent:whirlwind_of_death": 1 },
      equipment: { mainHand: { kind: "weapon", id: "blade" } },
    });
    const enemy1 = makeTestActor({ id: "NPC_1", kind: "NPC", stats: { TOU: 0, AGI: 0, WS: 0 } as any });
    const enemy2 = makeTestActor({ id: "NPC_2", kind: "NPC", stats: { TOU: 0, AGI: 0, WS: 0 } as any });
    const enemy3 = makeTestActor({ id: "NPC_3", kind: "NPC", stats: { TOU: 0, AGI: 0, WS: 0 } as any });
    const weapon: Weapon = {
      id: "blade",
      name: "Blade",
      kind: "MELEE",
      damage: { tier: "fixed", add: 2 },
      damageType: "cutting",
      penetration: 0,
    };
    const baseSave = makeTestSave(storyPack, attacker);
    const saveWithActors = {
      ...baseSave,
      actorsById: {
        ...baseSave.actorsById,
        [enemy1.id]: enemy1,
        [enemy2.id]: enemy2,
        [enemy3.id]: enemy3,
      },
      weaponsById: {
        ...(baseSave.weaponsById || {}),
        [weapon.id]: weapon,
      },
    };
    const combatSave = startCombat(storyPack, saveWithActors, [attacker.id, enemy1.id, enemy2.id, enemy3.id]);
    const combat = combatSave.runtime.combat!;
    const attackerIndex = combat.participants.indexOf(attacker.id);
    const saveWithPositions = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combat,
          currentIndex: attackerIndex,
          positions: {
            [attacker.id]: { x: 1, y: 1 },
            [enemy1.id]: { x: 2, y: 1 },
            [enemy2.id]: { x: 1, y: 2 },
            [enemy3.id]: { x: 0, y: 1 },
          },
          turn: {
            ...combat.turn,
            actionAvailable: true,
          },
        },
      },
    };
    const rng = new FakeRng([10, 90, 10, 90, 10, 90]);

    const effect: Effect = {
      op: "combatWhirlwindAttack",
      attackerId: attacker.id,
      weaponId: weapon.id,
    };

    const result = combatWhirlwindAttack(effect as Extract<Effect, { op: "combatWhirlwindAttack" }>, storyPack, saveWithPositions, rng);

    expect(result.save.actorsById[enemy1.id].resources.wounds).toBeGreaterThan(0);
    expect(result.save.actorsById[enemy2.id].resources.wounds).toBeGreaterThan(0);
    expect(result.save.actorsById[enemy3.id].resources.wounds).toBeGreaterThan(0);
  });
});
