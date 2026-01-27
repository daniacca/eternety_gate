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

const soullessAuraTalents = [
  {
    id: "talent:soulless_aura_1",
    name: "Soulless Aura I",
    tier: 2,
    xpCost: 1000,
    prerequisites: [{ type: "hasTrait", traitId: "trait:untouchable" }],
    grants: [],
    maxRank: 1,
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
    expect(damageEntry?.tags?.includes("magic:overcast=2")).toBe(true);
  });

  it("should not overflow when target is inside an untouchable field", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits, talents: soullessAuraTalents as any });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 70, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:flame_bolt": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
    });
    const untouchable = makeTestActor({
      id: "NPC_2",
      kind: "NPC",
      stats: { WIL: 40 } as any,
      traits: { "trait:untouchable": {} },
      talents: { "talent:soulless_aura_1": 1 },
    });

    const save = makeTestSave(storyPack, caster);
    const saveWithActors = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [target.id]: target,
        [untouchable.id]: untouchable,
      },
    };
    const combatSave = startCombat(storyPack, saveWithActors, [caster.id, target.id, untouchable.id]);
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
            [caster.id]: { x: 5, y: 5 },
            [untouchable.id]: { x: 1, y: 1 },
            [target.id]: { x: 3, y: 3 }, // dist=2 from untouchable, within range
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
      targetSelection: { kind: "single", targetPos: { x: 3, y: 3 } },
    };

    const rng = new FixedRng([42], [5, 5]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);
    const runtimeLog = result.save.runtime.runtimeLog ?? [];
    expect(runtimeLog.some((entry) => entry.kind === "system" && entry.tags?.includes("magic:resisted"))).toBe(true);
  });
});

describe("combatCastSpell - magic conduct", () => {
  it("should spend fate and add DoS bonus on success", () => {
    const storyPack = makeTestStoryPack({
      traits: baseTraits,
      talents: [
        {
          id: "talent:magic_conduct",
          name: "Magic Conduct",
          tier: 3,
          xpCost: 1000,
          prerequisites: [{ type: "hasTrait", traitId: "trait:weaver" }],
          grants: [{ type: "unlockAction", actionId: "magic:conduct" }],
        },
      ],
    });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 80, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      talents: { "talent:magic_conduct": 1 },
      resources: { fatePoints: 2 },
      spells: { "spell:flame_bolt": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
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
      castOptions: { magicConduct: true },
    };

    const rng = new FixedRng([10], [3, 1, 1, 1, 1, 1]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);

    expect(result.save.actorsById[caster.id].resources.fatePoints).toBe(1);
    const conductLog = result.save.runtime.runtimeLog?.find((entry) => entry.tags?.includes("magic:conduct"));
    expect(conductLog).toBeTruthy();
  });
});

describe("combatCastSpell - From Beyond immunity", () => {
  it("should ignore MENTIS effects on From Beyond targets", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { INT: 100, WIL: 50, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:mentis_disrupt": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      traits: { "trait:from_beyond": {} },
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
      spellId: "spell:mentis_disrupt",
      targetSelection: { kind: "single", targetPos: { x: 2, y: 1 } },
    };

    const rng = new FixedRng([1], [5]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);

    expect(result.save.actorsById[target.id].resources.rf ?? 0).toBe(0);
  });
});
