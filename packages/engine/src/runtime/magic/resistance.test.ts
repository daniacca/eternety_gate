import { describe, it, expect } from "vitest";
import { makeTestActor } from "../test-helpers/makeTestActor";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { startCombat } from "../combat/combat";
import { getMagicResistanceAgainstSpell } from "./resistance";
import type { CharacterCatalogs, Trait, Talent } from "../../content/catalogs";

const soullessTalents: Talent[] = [
  {
    id: "talent:soulless_aura_1",
    name: "Soulless Aura I",
    tier: 2,
    xpCost: 1000,
    prerequisites: [{ type: "hasTrait", traitId: "trait:untouchable" }],
    grants: [],
    maxRank: 1,
  },
  {
    id: "talent:soulless_aura_2",
    name: "Soulless Aura II",
    tier: 3,
    xpCost: 2000,
    prerequisites: [
      { type: "hasTrait", traitId: "trait:untouchable" },
      { type: "hasTalent", talentId: "talent:soulless_aura_1" },
    ],
    grants: [],
    maxRank: 1,
  },
  {
    id: "talent:arcane_abjuration_1",
    name: "Arcane Abjuration I",
    tier: 1,
    xpCost: 500,
    prerequisites: [{ type: "hasTrait", traitId: "trait:untouchable" }],
    grants: [],
    maxRank: 1,
  },
];

const unnaturalTrait: Trait = {
  id: "trait:unnatural_characteristic",
  name: "Unnatural Characteristic",
  params: {
    characteristics: {
      type: "array",
      items: {
        stat: { type: "string", required: true },
        bonusX: { type: "number", required: true },
      },
    },
  },
  grants: [
    { type: "modifier", key: "stat.<stat>.bonusAdd", op: "add", valueRef: "bonusX" },
    { type: "modifier", key: "stat.<stat>.testAdd", op: "add", value: 0 },
  ],
};

describe("getMagicResistanceAgainstSpell", () => {
  it("should not apply aura MR when radius is melee-only", () => {
    const storyPack = makeTestStoryPack();
    const untouchable = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { WIL: 40 } as any,
      traits: { "trait:untouchable": {} },
    });
    const target = makeTestActor({ id: "NPC_2", kind: "NPC" });
    const caster = makeTestActor({ id: "PC_1", kind: "PC" });

    const save = makeTestSave(storyPack, caster);
    const saveWithActors = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [untouchable.id]: untouchable,
        [target.id]: target,
      },
    };
    const combatSave = startCombat(storyPack, saveWithActors, [caster.id, untouchable.id, target.id]);
    const saveWithPositions = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          positions: {
            [untouchable.id]: { x: 1, y: 1 },
            [target.id]: { x: 3, y: 1 }, // dist=2
            [caster.id]: { x: 5, y: 5 },
          },
        },
      },
    };

    const catalogs: CharacterCatalogs = { skills: [], talents: soullessTalents, traits: [] };
    const mr = getMagicResistanceAgainstSpell(saveWithPositions, target.id, caster.id, catalogs);
    expect(mr).toBe(0);
  });

  it("should apply aura MR when radius > 1", () => {
    const storyPack = makeTestStoryPack();
    const untouchable = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { WIL: 40 } as any,
      traits: { "trait:untouchable": {} },
      talents: { "talent:soulless_aura_1": 1 },
    });
    const target = makeTestActor({ id: "NPC_2", kind: "NPC" });
    const caster = makeTestActor({ id: "PC_1", kind: "PC" });

    const save = makeTestSave(storyPack, caster);
    const saveWithActors = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [untouchable.id]: untouchable,
        [target.id]: target,
      },
    };
    const combatSave = startCombat(storyPack, saveWithActors, [caster.id, untouchable.id, target.id]);
    const saveWithPositions = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          positions: {
            [untouchable.id]: { x: 1, y: 1 },
            [target.id]: { x: 3, y: 1 }, // dist=2, radius=2
            [caster.id]: { x: 5, y: 5 },
          },
        },
      },
    };

    const catalogs: CharacterCatalogs = { skills: [], talents: soullessTalents, traits: [] };
    const mr = getMagicResistanceAgainstSpell(saveWithPositions, target.id, caster.id, catalogs);
    expect(mr).toBe(4); // WIL 40 => bonus 4
  });

  it("should reflect WIL bonus modifiers in aura MR", () => {
    const storyPack = makeTestStoryPack();
    const untouchable = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { WIL: 40 } as any,
      traits: {
        "trait:untouchable": {},
        "trait:unnatural_characteristic": {
          characteristics: [{ stat: "WIL", bonusX: 1 }],
        },
      },
      talents: {
        "talent:soulless_aura_2": 1,
        "talent:arcane_abjuration_1": 1,
      },
    });
    const target = makeTestActor({ id: "NPC_2", kind: "NPC" });
    const caster = makeTestActor({ id: "PC_1", kind: "PC" });

    const save = makeTestSave(storyPack, caster);
    const saveWithActors = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [untouchable.id]: untouchable,
        [target.id]: target,
      },
    };
    const combatSave = startCombat(storyPack, saveWithActors, [caster.id, untouchable.id, target.id]);
    const saveWithPositions = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          positions: {
            [untouchable.id]: { x: 1, y: 1 },
            [target.id]: { x: 2, y: 1 },
            [caster.id]: { x: 5, y: 5 },
          },
        },
      },
    };

    const catalogs: CharacterCatalogs = {
      skills: [],
      talents: soullessTalents,
      traits: [unnaturalTrait],
    };
    const mr = getMagicResistanceAgainstSpell(saveWithPositions, target.id, caster.id, catalogs);
    expect(mr).toBe(6); // base 4 + unnatural 1 + abjuration 1
  });
});
