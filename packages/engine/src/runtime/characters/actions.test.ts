import { describe, it, expect } from "vitest";
import type { GameSave, Actor } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { hasUnlockedAction } from "./actions";

describe("hasUnlockedAction", () => {
  const createMockSave = (actor: Actor): GameSave => ({
    party: { activeActorId: actor.id, memberIds: [actor.id] },
    actorsById: { [actor.id]: actor },
    weaponsById: {},
    armorsById: {},
    runtime: {
      rngSeed: 12345,
      rngCounter: 0,
    },
  });

  const createMockCatalogs = (): CharacterCatalogs => ({
    skills: [],
    talents: [
      {
        id: "talent:disarm",
        name: "Disarmare",
        tier: 2,
        xpCost: 1000,
        prerequisites: [{ type: "statAtLeast", stat: "WS", value: 40 }],
        grants: [{ type: "unlockAction", actionId: "combat:disarm" }],
        maxRank: 1,
      },
      {
        id: "talent:takedown",
        name: "Atterramento",
        tier: 1,
        xpCost: 500,
        prerequisites: [],
        grants: [{ type: "unlockAction", actionId: "combat:knockdown" }],
        maxRank: 1,
      },
    ],
    traits: [
      {
        id: "trait:weaver",
        name: "Tessitore della Trama",
        grants: [
          { type: "unlockAction", actionId: "magic:cast" },
          { type: "unlockAction", actionId: "magic:channel" },
        ],
      },
    ],
  });

  it("should return false if actor has no talents or traits", () => {
    const actor: Actor = {
      id: "PC_1",
      name: "Test Actor",
      kind: "PC",
      tags: [],
      stats: { STR: 50, TOU: 50, AGI: 50, INT: 50, WIL: 50, CHA: 50, WS: 50, BS: 50, INI: 50, PER: 50 },
      resources: { hp: 100, rf: 0, peq: 3 },
      skills: {},
      talents: {},
      traits: {},
      equipment: {},
      status: { conditions: [], tempModifiers: [] },
    };
    const save = createMockSave(actor);
    const catalogs = createMockCatalogs();

    expect(hasUnlockedAction(save, catalogs, "PC_1", "combat:disarm")).toBe(false);
    expect(hasUnlockedAction(save, catalogs, "PC_1", "magic:cast")).toBe(false);
  });

  it("should return true if actor has talent that unlocks the action", () => {
    const actor: Actor = {
      id: "PC_1",
      name: "Test Actor",
      kind: "PC",
      tags: [],
      stats: { STR: 50, TOU: 50, AGI: 50, INT: 50, WIL: 50, CHA: 50, WS: 50, BS: 50, INI: 50, PER: 50 },
      resources: { hp: 100, rf: 0, peq: 3 },
      skills: {},
      talents: { "talent:disarm": 1 },
      traits: {},
      equipment: {},
      status: { conditions: [], tempModifiers: [] },
    };
    const save = createMockSave(actor);
    const catalogs = createMockCatalogs();

    expect(hasUnlockedAction(save, catalogs, "PC_1", "combat:disarm")).toBe(true);
    expect(hasUnlockedAction(save, catalogs, "PC_1", "combat:knockdown")).toBe(false);
  });

  it("should return false if actor has talent with rank 0", () => {
    const actor: Actor = {
      id: "PC_1",
      name: "Test Actor",
      kind: "PC",
      tags: [],
      stats: { STR: 50, TOU: 50, AGI: 50, INT: 50, WIL: 50, CHA: 50, WS: 50, BS: 50, INI: 50, PER: 50 },
      resources: { hp: 100, rf: 0, peq: 3 },
      skills: {},
      talents: { "talent:disarm": 0 },
      traits: {},
      equipment: {},
      status: { conditions: [], tempModifiers: [] },
    };
    const save = createMockSave(actor);
    const catalogs = createMockCatalogs();

    expect(hasUnlockedAction(save, catalogs, "PC_1", "combat:disarm")).toBe(false);
  });

  it("should return true if actor has trait that unlocks the action", () => {
    const actor: Actor = {
      id: "PC_1",
      name: "Test Actor",
      kind: "PC",
      tags: [],
      stats: { STR: 50, TOU: 50, AGI: 50, INT: 50, WIL: 50, CHA: 50, WS: 50, BS: 50, INI: 50, PER: 50 },
      resources: { hp: 100, rf: 0, peq: 3 },
      skills: {},
      talents: {},
      traits: { "trait:weaver": {} },
      equipment: {},
      status: { conditions: [], tempModifiers: [] },
    };
    const save = createMockSave(actor);
    const catalogs = createMockCatalogs();

    expect(hasUnlockedAction(save, catalogs, "PC_1", "magic:cast")).toBe(true);
    expect(hasUnlockedAction(save, catalogs, "PC_1", "magic:channel")).toBe(true);
    expect(hasUnlockedAction(save, catalogs, "PC_1", "combat:disarm")).toBe(false);
  });

  it("should return true if actor has multiple talents/traits that unlock different actions", () => {
    const actor: Actor = {
      id: "PC_1",
      name: "Test Actor",
      kind: "PC",
      tags: [],
      stats: { STR: 50, TOU: 50, AGI: 50, INT: 50, WIL: 50, CHA: 50, WS: 50, BS: 50, INI: 50, PER: 50 },
      resources: { hp: 100, rf: 0, peq: 3 },
      skills: {},
      talents: { "talent:disarm": 1, "talent:takedown": 1 },
      traits: { "trait:weaver": {} },
      equipment: {},
      status: { conditions: [], tempModifiers: [] },
    };
    const save = createMockSave(actor);
    const catalogs = createMockCatalogs();

    expect(hasUnlockedAction(save, catalogs, "PC_1", "combat:disarm")).toBe(true);
    expect(hasUnlockedAction(save, catalogs, "PC_1", "combat:knockdown")).toBe(true);
    expect(hasUnlockedAction(save, catalogs, "PC_1", "magic:cast")).toBe(true);
    expect(hasUnlockedAction(save, catalogs, "PC_1", "magic:channel")).toBe(true);
  });

  it("should return false for non-existent actor", () => {
    const actor: Actor = {
      id: "PC_1",
      name: "Test Actor",
      kind: "PC",
      tags: [],
      stats: { STR: 50, TOU: 50, AGI: 50, INT: 50, WIL: 50, CHA: 50, WS: 50, BS: 50, INI: 50, PER: 50 },
      resources: { hp: 100, rf: 0, peq: 3 },
      skills: {},
      talents: { "talent:disarm": 1 },
      traits: {},
      equipment: {},
      status: { conditions: [], tempModifiers: [] },
    };
    const save = createMockSave(actor);
    const catalogs = createMockCatalogs();

    expect(hasUnlockedAction(save, catalogs, "NON_EXISTENT", "combat:disarm")).toBe(false);
  });

  it("should return false for action that is not unlocked by any talent or trait", () => {
    const actor: Actor = {
      id: "PC_1",
      name: "Test Actor",
      kind: "PC",
      tags: [],
      stats: { STR: 50, TOU: 50, AGI: 50, INT: 50, WIL: 50, CHA: 50, WS: 50, BS: 50, INI: 50, PER: 50 },
      resources: { hp: 100, rf: 0, peq: 3 },
      skills: {},
      talents: { "talent:disarm": 1 },
      traits: {},
      equipment: {},
      status: { conditions: [], tempModifiers: [] },
    };
    const save = createMockSave(actor);
    const catalogs = createMockCatalogs();

    expect(hasUnlockedAction(save, catalogs, "PC_1", "combat:unknownAction")).toBe(false);
  });
});

