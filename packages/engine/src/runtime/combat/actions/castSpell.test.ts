import { describe, it, expect } from "vitest";
import { combatCastSpell } from "./castSpell";
import { makeTestStoryPack } from "../../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../../test-helpers/makeTestActor";
import { makeTestSave } from "../../test-helpers/makeTestSave";
import { startCombat } from "../combat";
import type { Effect } from "../../types";
import type { IRNG } from "../../rng";

class FixedRng implements IRNG {
  private rolls: number[];
  private ints: number[];

  constructor(rolls: number[], ints: number[]) {
    this.rolls = [...rolls];
    this.ints = [...ints];
  }

  rollD100(): number {
    return this.rolls.shift() ?? 1;
  }

  next(): number {
    return 0;
  }

  getCounter(): number {
    return 0;
  }

  getSeed(): number {
    return 0;
  }

  nextInt(min: number, max: number): number {
    const value = this.ints.shift() ?? min;
    return Math.min(max, Math.max(min, value));
  }
}

const baseTraits = [
  {
    id: "trait:weaver",
    name: "Weaver",
    grants: [
      { type: "unlockAction", actionId: "magic:cast" },
      { type: "unlockAction", actionId: "magic:channel" },
    ],
  },
  {
    id: "trait:magic_resistance",
    name: "Magic Resistance",
    params: {
      x: { type: "number", required: true },
    },
    grants: [{ type: "modifier", key: "magic.resistance", op: "add", valueRef: "x" }],
  },
];

describe("combatCastSpell - magic resistance", () => {
  it("should fully resist target when magic resistance >= manifested PM", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 100, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:flame_bolt": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      traits: { "trait:magic_resistance": { x: 10 } },
    });

    const save = makeTestSave(storyPack, caster);
    const saveWithTarget = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [target.id]: target,
      },
    };
    const combatSave = startCombat(storyPack, saveWithTarget, [caster.id, target.id]);
    const combat = combatSave.runtime.combat!;
    const casterIndex = combat.participants.indexOf(caster.id);
    const saveWithPositions = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combat,
          currentIndex: casterIndex,
          positions: {
            [caster.id]: { x: 1, y: 1 },
            [target.id]: { x: 2, y: 1 },
          },
          turn: {
            ...combat.turn,
            actionAvailable: true,
          },
        },
      },
    };

    const effect: Effect = {
      op: "combatCastSpell",
      actorId: caster.id,
      spellId: "spell:flame_bolt",
      targetSelection: { kind: "single", targetPos: { x: 2, y: 1 } },
    };

    const rng = new FixedRng([42], [5, 5]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);

    expect(result.save.actorsById[target.id].resources.wounds ?? 0).toBe(0);
    const runtimeLog = result.save.runtime.runtimeLog ?? [];
    expect(runtimeLog.some((entry) => entry.kind === "system" && entry.tags?.includes("magic:resisted"))).toBe(true);
  });

  it("should reduce overcast only for the resisted target", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 100, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:flame_bolt": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      traits: { "trait:magic_resistance": { x: 2 } },
    });

    const save = makeTestSave(storyPack, caster);
    const saveWithTarget = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [target.id]: target,
      },
    };
    const combatSave = startCombat(storyPack, saveWithTarget, [caster.id, target.id]);
    const combat = combatSave.runtime.combat!;
    const casterIndex = combat.participants.indexOf(caster.id);
    const saveWithPositions = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combat,
          currentIndex: casterIndex,
          positions: {
            [caster.id]: { x: 1, y: 1 },
            [target.id]: { x: 2, y: 1 },
          },
          turn: {
            ...combat.turn,
            actionAvailable: true,
          },
        },
      },
    };

    const effect: Effect = {
      op: "combatCastSpell",
      actorId: caster.id,
      spellId: "spell:flame_bolt",
      targetSelection: { kind: "single", targetPos: { x: 2, y: 1 } },
    };

    const rng = new FixedRng([42], [5, 5]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);
    const runtimeLog = result.save.runtime.runtimeLog ?? [];
    const damageEntry = runtimeLog.find((entry) => entry.kind === "damage" && entry.defenderId === target.id);
    expect(damageEntry?.tags?.includes("magic:overcast=1")).toBe(true);
  });
});
