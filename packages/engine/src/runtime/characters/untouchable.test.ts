import { describe, it, expect } from "vitest";
import { makeTestActor } from "../test-helpers/makeTestActor";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { getUntouchableEffectiveWilBonus, getUntouchableAuraRadius } from "./untouchable";
import { canAcquireTalent } from "./prerequisites";
import type { CharacterCatalogs, Talent } from "../../content/catalogs";

const soullessTalents: Talent[] = [
  {
    id: "talent:arcane_abjuration_1",
    name: "Arcane Abjuration I",
    tier: 1,
    xpCost: 500,
    prerequisites: [{ type: "hasTrait", traitId: "trait:untouchable" }],
    grants: [],
    maxRank: 1,
  },
  {
    id: "talent:arcane_abjuration_2",
    name: "Arcane Abjuration II",
    tier: 2,
    xpCost: 1000,
    prerequisites: [
      { type: "hasTrait", traitId: "trait:untouchable" },
      { type: "hasTalent", talentId: "talent:arcane_abjuration_1" },
    ],
    grants: [],
    maxRank: 1,
  },
  {
    id: "talent:arcane_abjuration_3",
    name: "Arcane Abjuration III",
    tier: 3,
    xpCost: 2000,
    prerequisites: [
      { type: "hasTrait", traitId: "trait:untouchable" },
      { type: "hasTalent", talentId: "talent:arcane_abjuration_2" },
    ],
    grants: [],
    maxRank: 1,
  },
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
];

describe("untouchable talents", () => {
  it("should add Arcane Abjuration ranks to effective WIL bonus", () => {
    const actor = makeTestActor({
      id: "PC_1",
      stats: { WIL: 45 },
      traits: { "trait:untouchable": {} },
      talents: {
        "talent:arcane_abjuration_1": 1,
        "talent:arcane_abjuration_2": 1,
      },
    });
    const save = makeTestSave(makeTestStoryPack(), actor);

    const effectiveBonus = getUntouchableEffectiveWilBonus(save, actor.id);
    expect(effectiveBonus).toBe(6); // base 4 + 2 ranks
  });

  it("should compute aura radius from Soulless Aura talents and effective WIL", () => {
    const actor = makeTestActor({
      id: "PC_1",
      stats: { WIL: 40 },
      traits: { "trait:untouchable": {} },
      talents: {
        "talent:arcane_abjuration_1": 1,
        "talent:arcane_abjuration_2": 1,
        "talent:soulless_aura_1": 1,
      },
    });
    const save = makeTestSave(makeTestStoryPack(), actor);
    const catalogs: CharacterCatalogs = { skills: [], talents: soullessTalents, traits: [] };

    const radius = getUntouchableAuraRadius(save, catalogs, actor.id);
    expect(radius).toBe(3); // effective WIL bonus 6 => ceil(6/2) = 3

    const actorWithAura2 = {
      ...actor,
      talents: {
        ...actor.talents,
        "talent:soulless_aura_2": 1,
      },
    };
    const saveWithAura2 = makeTestSave(makeTestStoryPack(), actorWithAura2);
    const radius2 = getUntouchableAuraRadius(saveWithAura2, catalogs, actorWithAura2.id);
    expect(radius2).toBe(6);
  });

  it("should block acquiring soulless talents without trait:untouchable", () => {
    const actor = makeTestActor({
      id: "PC_1",
      resources: { xp: 500 },
      traits: {},
    });
    const save = makeTestSave(makeTestStoryPack(), actor);
    const catalogs: CharacterCatalogs = { skills: [], talents: soullessTalents, traits: [] };
    const talent = soullessTalents[0];

    const result = canAcquireTalent(save, catalogs, actor, talent);
    expect(result.canAcquire).toBe(false);
    expect(result.reason).toContain("trait:untouchable");
  });
});
