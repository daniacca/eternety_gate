import { describe, it, expect } from "vitest";
import { combatCastSpell } from "./castSpell";
import { getEffectById, getSpellById } from "../../magic/catalogs";
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

const doubleCastTalent = [
  {
    id: "talent:double_casting",
    name: "Double Casting",
    tier: 3,
    xpCost: 1000,
    prerequisites: [{ type: "hasTrait", traitId: "trait:weaver" }],
    grants: [{ type: "unlockAction", actionId: "magic:doubleCast" }],
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
    expect(damageEntry?.tags?.includes("magic:overcast=0")).toBe(true);
  });

  it("should not overflow when target is inside an untouchable field", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits, talents: soullessAuraTalents as any });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 80, INI: 50 } as any,
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
      stats: { WIL: 300, INI: 50 } as any,
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

describe("combatCastSpell - effect stat scaling", () => {
  it("should add effect stat bonus to damage", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 55, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:flame_bolt": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { TOU: 0 } as any,
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

    const rng = new FixedRng([45], [4, 7]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);
    const runtimeLog = result.save.runtime.runtimeLog ?? [];
    const damageEntry = runtimeLog.find((entry) => entry.kind === "damage" && entry.defenderId === target.id);
    expect(damageEntry?.rawDamage).toBe(16);
  });

  it("should add effect stat bonus to condition duration", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 55, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:kinesis_force_bind": true },
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
      spellId: "spell:kinesis_force_bind",
      targetSelection: { kind: "single", targetPos: { x: 2, y: 1 } },
    };

    const rng = new FixedRng([45], [1]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);
    const boundCondition = result.save.actorsById[target.id].conditions?.bound;
    expect(boundCondition?.untilTurnCounter).toBe(8);
  });
});

describe("combatCastSpell - fixed duration modifiers", () => {
  it("should keep vates premonition duration fixed to 1 round base", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { PER: 90, WIL: 50, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:vates_premonition": true },
    });

    const save = makeTestSave(storyPack, caster);
    const combatSave = startCombat(storyPack, save, [caster.id]);
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
      spellId: "spell:vates_premonition",
      targetSelection: { kind: "self" },
    };

    const rng = new FixedRng([10], [1]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);
    const modifier = result.save.actorsById[caster.id].status.tempModifiers.find(
      (mod) => mod.id === "spell:spell:vates_premonition:PC_1"
    );
    const turnCounter = result.save.runtime.combat?.turnCounter ?? 0;
    const overcastTag = result.save.runtime.lastCheck?.tags?.find((tag) => tag.startsWith("magic:overcast="));
    const overcast = overcastTag ? parseInt(overcastTag.split("=")[1] || "0", 10) : 0;
    expect((modifier?.expires ?? 0) - turnCounter).toBe(1 + overcast);
  });
});

describe("combatCastSpell - double cast", () => {
  it("should cast two spells with a shared check", () => {
    const storyPack = makeTestStoryPack({
      traits: baseTraits,
      talents: doubleCastTalent as any,
    });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 70, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      talents: { "talent:double_casting": 1 },
      spells: { "spell:flame_bolt": true, "spell:pyra_flame_control": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { TOU: 0 } as any,
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
      secondarySpellId: "spell:pyra_flame_control",
      targetSelection: { kind: "single", targetPos: { x: 2, y: 1 } },
    };

    const rng = new FixedRng([40], [3, 4, 2]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);

    const runtimeLog = result.save.runtime.runtimeLog ?? [];
    const damageEntries = runtimeLog.filter((entry) => entry.kind === "damage" && entry.defenderId === target.id);
    expect(damageEntries.length).toBe(2);
    expect(result.save.runtime.lastCheck?.tags?.includes("magic:doubleCast=1")).toBe(true);
  });
});

describe("combatCastSpell - forced movement", () => {
  it("should push target away from caster", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 60, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:kinesis_force_push": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { TOU: 0 } as any,
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
      spellId: "spell:kinesis_force_push",
      targetSelection: { kind: "single", targetPos: { x: 2, y: 1 } },
    };

    const rng = new FixedRng([40], [5]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);
    expect(result.save.runtime.combat?.positions?.[target.id]).toEqual({ x: 4, y: 1 });
  });

  it("should apply impact damage when blocked by non-walkable terrain", () => {
    const storyPack = makeTestStoryPack({
      traits: baseTraits,
      grids: [
        {
          id: "arena_01",
          width: 10,
          height: 10,
          defaults: { walkable: true, cover: "none", tileId: "plains" },
          cells: {
            "3,1": { walkable: false, cover: "none", tileId: "wall" },
          },
        },
      ],
      tiles: { plains: {}, wall: {} },
    } as any);
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 60, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:kinesis_force_push": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { TOU: 0 } as any,
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
      spellId: "spell:kinesis_force_push",
      targetSelection: { kind: "single", targetPos: { x: 2, y: 1 } },
    };

    const rng = new FixedRng([40], [5, 4]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);
    const runtimeLog = result.save.runtime.runtimeLog ?? [];
    const impactEntry = runtimeLog.find((entry) => entry.kind === "damage" && entry.tags?.includes("magic:forcedMoveImpact=1"));
    expect(impactEntry).toBeTruthy();
    expect(result.save.runtime.combat?.positions?.[target.id]).toEqual({ x: 2, y: 1 });
  });

  it("should not move targets with size 8 or above", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 60, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:kinesis_force_push": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { TOU: 0 } as any,
      traits: { "trait:size": { size: 8 } },
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
      spellId: "spell:kinesis_force_push",
      targetSelection: { kind: "single", targetPos: { x: 2, y: 1 } },
    };

    const rng = new FixedRng([40], [5]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);
    expect(result.save.runtime.combat?.positions?.[target.id]).toEqual({ x: 2, y: 1 });
  });

  it("should apply prone only when overcast threshold is met", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 300, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:kinesis_force_push": true },
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
      spellId: "spell:kinesis_force_push",
      targetSelection: { kind: "single", targetPos: { x: 2, y: 1 } },
    };

    const rng = new FixedRng([10], [5]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);
    expect(result.save.actorsById[target.id].conditions?.prone).toBeDefined();
  });
});

describe("combatCastSpell - shockwave", () => {
  it("should use effect stat bonus as radius and push targets", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 50, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:kinesis_shockwave": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { TOU: 0 } as any,
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
            [target.id]: { x: 4, y: 1 },
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
      spellId: "spell:kinesis_shockwave",
      targetSelection: { kind: "radius", centerPos: { x: 1, y: 1 } },
    };

    const rng = new FixedRng([20], [6]);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);
    expect(result.save.runtime.combat?.positions?.[target.id]).toEqual({ x: 9, y: 1 });
    const runtimeLog = result.save.runtime.runtimeLog ?? [];
    const damageEntry = runtimeLog.find((entry) => entry.kind === "damage" && entry.defenderId === target.id);
    expect(damageEntry).toBeTruthy();
  });
});

describe("combatCastSpell - mentis additions", () => {
  it("should apply invisibility aura to allies with wil bonus params", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 50, INT: 60, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:mentis_veil_invisibility": true },
    });
    const ally = makeTestActor({
      id: "PC_2",
      kind: "PC",
      stats: { INI: 40 } as any,
    });
    const enemy = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { INI: 30 } as any,
    });

    const save = makeTestSave(storyPack, caster);
    const saveWithActors = {
      ...save,
      party: {
        actors: [caster.id, ally.id],
        activeActorId: caster.id,
      },
      actorsById: {
        ...save.actorsById,
        [ally.id]: ally,
        [enemy.id]: enemy,
      },
    };
    const combatSave = startCombat(storyPack, saveWithActors, [caster.id, ally.id, enemy.id]);
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
            [ally.id]: { x: 3, y: 1 },
            [enemy.id]: { x: 8, y: 1 },
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
      spellId: "spell:mentis_veil_invisibility",
      targetSelection: { kind: "radius", centerPos: { x: 1, y: 1 } },
    };

    const rng = new FixedRng([10], []);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);

    expect(result.save.actorsById[caster.id].conditions?.invisibility).toBeDefined();
    expect(result.save.actorsById[ally.id].conditions?.invisibility).toBeDefined();
    expect(result.save.actorsById[ally.id].conditions?.invisibility?.params?.wilBonus).toBe(5);
    expect(result.save.actorsById[ally.id].conditions?.invisibility?.params?.auraApplied).toBe(true);
    expect(result.save.actorsById[enemy.id].conditions?.invisibility).toBeUndefined();
  });

  it("should add mind controlled target to the party", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 80, INT: 80, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:mentis_control_mind": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { WIL: 30, INI: 30 } as any,
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
            [target.id]: { x: 4, y: 1 },
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
      spellId: "spell:mentis_control_mind",
      targetSelection: { kind: "single", targetPos: { x: 4, y: 1 } },
    };

    const rng = new FixedRng([1, 90], []);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);

    expect(result.save.actorsById[target.id].conditions?.mind_control).toBeDefined();
    expect(result.save.party.actors).toContain(target.id);
    const untilTurnCounter = result.save.actorsById[target.id].conditions?.mind_control?.untilTurnCounter ?? 0;
    expect(untilTurnCounter).toBe((combat.turnCounter ?? 0) + 8);
  });

  it("should apply shock to enemies failing vision of terror", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 60, INT: 70, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:mentis_vision_of_terror": true },
    });
    const targetA = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { WIL: 30, INI: 30 } as any,
    });
    const targetB = makeTestActor({
      id: "NPC_2",
      kind: "NPC",
      stats: { WIL: 30, INI: 25 } as any,
    });

    const save = makeTestSave(storyPack, caster);
    const saveWithTargets = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [targetA.id]: targetA,
        [targetB.id]: targetB,
      },
    };
    const combatSave = startCombat(storyPack, saveWithTargets, [caster.id, targetA.id, targetB.id]);
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
            [targetA.id]: { x: 2, y: 1 },
            [targetB.id]: { x: 3, y: 1 },
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
      spellId: "spell:mentis_vision_of_terror",
      targetSelection: { kind: "radius", centerPos: { x: 1, y: 1 } },
    };

    const rng = new FixedRng([10, 90, 90], []);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);

    expect(result.save.actorsById[targetA.id].conditions?.shock).toBeDefined();
    expect(result.save.actorsById[targetB.id].conditions?.shock).toBeDefined();
  });
});

describe("combatCastSpell - summon and daemonology additions", () => {
  it("should summon a divine spirit with expected setup", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 300, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: {
        "spell:santic_holy_fire": true,
        "spell:santic_sanctuary": true,
        "spell:santic_word_of_god": true,
        "spell:santic_daemonbane": true,
        "spell:santic_avatar": true,
        "spell:santic_summon": true,
      },
    });

    const spellDef = getSpellById("spell:santic_summon");
    const effectDef = getEffectById("effect:santic_summon");
    expect(spellDef).toBeTruthy();
    expect(effectDef?.specialOp).toBe("combatSummonDivine");

    const save = makeTestSave(storyPack, caster);
    const combatSave = startCombat(storyPack, save, [caster.id]);
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
            [caster.id]: { x: 3, y: 3 },
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
      spellId: "spell:santic_summon",
      targetSelection: { kind: "self" },
    };

    const rng = new FixedRng([1], []);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);
    const summonId = Object.keys(result.save.actorsById).find((id) => id.startsWith("SUMMON_DIVINE_"));
    expect(summonId).toBeTruthy();
    if (!summonId) return;

    const summoned = result.save.actorsById[summonId];
    expect(summoned.traits?.["trait:divine"]).toBeTruthy();
    expect(summoned.traits?.["trait:flyer"]).toBeTruthy();
    expect(summoned.traits?.["trait:natural_armour"]).toBeTruthy();
    expect(summoned.equipment?.mainHand?.id).toBe("sanctified_greatblade");
    expect(summoned.spells?.["spell:santic_holy_fire"]).toBeTruthy();
    expect(summoned.spells?.["spell:corpus_mend"]).toBeTruthy();
    expect(result.save.runtime.combat?.participants).toContain(summonId);
    expect(result.save.party.actors).toContain(summonId);
    expect(result.save.runtime.combat?.positions?.[summonId]).toBeDefined();
    expect(summoned.conditions?.summoned).toBeDefined();
  });

  it("should apply soul rend to divine targets", () => {
    const storyPack = makeTestStoryPack({ traits: baseTraits });
    const caster = makeTestActor({
      id: "PC_1",
      stats: { WIL: 70, INI: 50 } as any,
      traits: { "trait:weaver": {} },
      spells: { "spell:daemonology_soul_rend": true },
    });
    const target = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { WIL: 25, INI: 30 } as any,
      traits: { "trait:divine": { x: 2 } },
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
            [target.id]: { x: 4, y: 1 },
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
      spellId: "spell:daemonology_soul_rend",
      targetSelection: { kind: "single", targetPos: { x: 4, y: 1 } },
    };

    const rng = new FixedRng([1, 95], []);
    const result = combatCastSpell(effect as Extract<Effect, { op: "combatCastSpell" }>, storyPack, saveWithPositions, rng);
    expect(result.save.actorsById[target.id].resources.wounds).toBeGreaterThan(0);
  });
});
