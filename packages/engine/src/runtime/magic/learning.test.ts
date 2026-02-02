import { describe, it, expect } from "vitest";
import type { GameSave, Actor, ActorId } from "../types";
import { canLearnSpell } from "./learning";
import type { CharacterCatalogs } from "../../content/catalogs";

const createSave = (actor: Actor): GameSave => ({
  saveVersion: "1.0.0",
  story: { id: "test", version: "1.0.0" },
  state: { flags: {}, counters: {} },
  party: { actors: [actor.id], activeActorId: actor.id },
  actorsById: { [actor.id]: actor },
  itemsById: {},
  weaponsById: {},
  armorsById: {},
  runtime: {
    currentSceneId: "scene1",
    rngSeed: 1,
    rngCounter: 0,
    history: { visitedScenes: ["scene1"], chosenChoices: [] },
    firedWorldEvents: [],
  },
});

describe("canLearnSpell prerequisites", () => {
  const catalogs: CharacterCatalogs = {
    skills: [],
    talents: [],
    traits: [
      {
        id: "trait:weaver",
        name: "Weaver",
        grants: [],
      },
    ],
  };

  it("fails when hasSpell prerequisite is missing", () => {
    const actor: Actor = {
      id: "PC_1" as ActorId,
      name: "Mage",
      kind: "PC",
      stats: { STR: 40, TOU: 40, AGI: 40, INT: 40, WIL: 40, CHA: 40, WS: 40, BS: 40, INI: 40, PER: 40 },
      resources: { wounds: 0, rf: 0, fatePoints: 4, xp: 1000 },
      skills: {},
      talents: {},
      traits: { "trait:weaver": true },
      spells: {},
      equipment: {},
      status: { conditions: [], tempModifiers: [] },
    };
    const save = createSave(actor);

    const result = canLearnSpell(save, catalogs, actor.id, "spell:santic_sanctuary");
    expect(result.canLearn).toBe(false);
  });

  it("fails when hasTrait prerequisite is missing", () => {
    const actor: Actor = {
      id: "PC_1" as ActorId,
      name: "Mage",
      kind: "PC",
      stats: { STR: 40, TOU: 40, AGI: 40, INT: 40, WIL: 40, CHA: 40, WS: 40, BS: 40, INI: 40, PER: 40 },
      resources: { wounds: 0, rf: 0, fatePoints: 4, xp: 1000 },
      skills: {},
      talents: {},
      traits: {},
      spells: { "spell:santic_holy_fire": true },
      equipment: {},
      status: { conditions: [], tempModifiers: [] },
    };
    const save = createSave(actor);

    const result = canLearnSpell(save, catalogs, actor.id, "spell:santic_sanctuary");
    expect(result.canLearn).toBe(false);
  });

  it("passes when hasSpell and hasTrait prerequisites are met", () => {
    const actor: Actor = {
      id: "PC_1" as ActorId,
      name: "Mage",
      kind: "PC",
      stats: { STR: 40, TOU: 40, AGI: 40, INT: 40, WIL: 40, CHA: 40, WS: 40, BS: 40, INI: 40, PER: 40 },
      resources: { wounds: 0, rf: 0, fatePoints: 4, xp: 1000 },
      skills: {},
      talents: {},
      traits: { "trait:weaver": true },
      spells: { "spell:santic_holy_fire": true },
      equipment: {},
      status: { conditions: [], tempModifiers: [] },
    };
    const save = createSave(actor);

    const result = canLearnSpell(save, catalogs, actor.id, "spell:santic_sanctuary");
    expect(result.canLearn).toBe(true);
  });
});
