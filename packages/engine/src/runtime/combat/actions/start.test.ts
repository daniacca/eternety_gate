import { describe, it, expect } from "vitest";
import { combatStart } from "./start";
import { makeTestSave } from "../../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../../test-helpers/makeTestActor";
import { getCurrentTurnActorId } from "../combat";
import type { Effect } from "../../types";

describe("combatStart", () => {
  it("should start combat with participants", () => {
    const storyPack = makeTestStoryPack();
    const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 50 } as any });
    const actor2 = makeTestActor({ id: "NPC_1", stats: { INI: 30 } as any });
    const save = makeTestSave(storyPack, actor1);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [actor2.id]: actor2,
      },
    };

    const effect: Effect = {
      op: "combatStart",
      participantIds: ["PC_1", "NPC_1"],
      grid: { width: 10, height: 10 },
      placements: [
        { actorId: "PC_1", x: 0, y: 0 },
        { actorId: "NPC_1", x: 5, y: 5 },
      ],
    };
    const result = combatStart(effect as Extract<Effect, { op: "combatStart" }>, storyPack, saveWithBoth);

    expect(result.save.runtime.combat?.active).toBe(true);
    expect(result.save.runtime.combat?.participants).toContain("PC_1");
    expect(result.save.runtime.combat?.participants).toContain("NPC_1");
    expect(result.save.runtime.combat?.grid).toEqual({ width: 10, height: 10 });
    expect(result.save.runtime.combat?.positions?.["PC_1"]).toEqual({ x: 0, y: 0 });
    expect(result.save.runtime.combat?.positions?.["NPC_1"]).toEqual({ x: 5, y: 5 });
  });

  it("should use default grid if not provided", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50 } as any });
    const save = makeTestSave(storyPack, actor);

    const effect: Effect = {
      op: "combatStart",
      participantIds: ["PC_1"],
      placements: [],
    };
    const result = combatStart(effect as Extract<Effect, { op: "combatStart" }>, storyPack, save);

    expect(result.save.runtime.combat?.grid).toEqual({ width: 10, height: 10 });
  });

  it("should process NPC turns until player turn", () => {
    const storyPack = makeTestStoryPack();
    const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 30, AGI: 30 } as any });
    const actor2 = makeTestActor({ id: "NPC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor1);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [actor2.id]: actor2,
      },
    };

    const effect: Effect = {
      op: "combatStart",
      participantIds: ["PC_1", "NPC_1"],
      grid: { width: 10, height: 10 },
      placements: [
        { actorId: "PC_1", x: 0, y: 0 },
        { actorId: "NPC_1", x: 5, y: 5 },
      ],
    };
    const result = combatStart(effect as Extract<Effect, { op: "combatStart" }>, storyPack, saveWithBoth);

    // After processing NPC turns, it should be player's turn
    const turnActorId = getCurrentTurnActorId(result.save);
    expect(turnActorId).toBe("PC_1");
  });

  it("should filter out dead participants", () => {
    const storyPack = makeTestStoryPack();
    const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 50 } as any });
    const actor2 = makeTestActor({
      id: "NPC_1",
      stats: { INI: 30 } as any,
      resources: { wounds: 100, rf: 0, peq: 0, isDead: true },
    });
    const save = makeTestSave(storyPack, actor1);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [actor2.id]: actor2,
      },
    };

    const effect: Effect = {
      op: "combatStart",
      participantIds: ["PC_1", "NPC_1"],
      placements: [],
    };
    const result = combatStart(effect as Extract<Effect, { op: "combatStart" }>, storyPack, saveWithBoth);

    expect(result.save.runtime.combat?.participants).not.toContain("NPC_1");
    expect(result.save.runtime.combat?.participants).toContain("PC_1");
  });

  it("should initialize combat log", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50 } as any });
    const save = makeTestSave(storyPack, actor);

    const effect: Effect = {
      op: "combatStart",
      participantIds: ["PC_1", "NPC_1"],
      grid: { width: 10, height: 10 },
      placements: [
        { actorId: "PC_1", x: 0, y: 0 },
        { actorId: "NPC_1", x: 5, y: 5 },
      ],
    };
    const result = combatStart(effect as Extract<Effect, { op: "combatStart" }>, storyPack, save);

    expect(result.save.runtime.combatLog).toBeDefined();
    expect(result.save.runtime.combatLog?.length).toBeGreaterThan(0);
  });

  it("should apply Fear at combat start and add shock on failure", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { WIL: 10, INI: 50 } as any });
    const fearSource = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { INI: 30 } as any,
      traits: { "trait:fear": { x: 3 } },
    });
    const save = makeTestSave(storyPack, actor);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [fearSource.id]: fearSource,
      },
    };

    const effect: Effect = {
      op: "combatStart",
      participantIds: ["PC_1", "NPC_1"],
      placements: [
        { actorId: "PC_1", x: 0, y: 0 },
        { actorId: "NPC_1", x: 1, y: 0 },
      ],
    };
    const result = combatStart(effect as Extract<Effect, { op: "combatStart" }>, storyPack, saveWithBoth);

    expect(result.save.actorsById["PC_1"].conditions?.shock).toBeDefined();
  });

  it("should ignore Fear for actors with From Beyond", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({
      id: "PC_1",
      stats: { WIL: 10, INI: 50 } as any,
      traits: { "trait:from_beyond": {} },
    });
    const fearSource = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { INI: 30 } as any,
      traits: { "trait:fear": { x: 3 } },
    });
    const save = makeTestSave(storyPack, actor);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [fearSource.id]: fearSource,
      },
    };

    const effect: Effect = {
      op: "combatStart",
      participantIds: ["PC_1", "NPC_1"],
      placements: [
        { actorId: "PC_1", x: 0, y: 0 },
        { actorId: "NPC_1", x: 1, y: 0 },
      ],
    };
    const result = combatStart(effect as Extract<Effect, { op: "combatStart" }>, storyPack, saveWithBoth);

    expect(result.save.actorsById["PC_1"].conditions?.shock).toBeUndefined();
  });

  it("should ignore Fear for actors with Jaded talent", () => {
    const storyPack = makeTestStoryPack({
      talents: [
        {
          id: "talent:jaded",
          name: "Jaded",
          tier: 2,
          xpCost: 500,
          prerequisites: [],
          grants: [{ type: "hook", hookId: "jaded" }],
        },
      ],
    });
    const actor = makeTestActor({
      id: "PC_1",
      stats: { WIL: 10, INI: 50 } as any,
      talents: { "talent:jaded": 1 },
    });
    const fearSource = makeTestActor({
      id: "NPC_1",
      kind: "NPC",
      stats: { INI: 30 } as any,
      traits: { "trait:fear": { x: 3 } },
    });
    const save = makeTestSave(storyPack, actor);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [fearSource.id]: fearSource,
      },
    };

    const effect: Effect = {
      op: "combatStart",
      participantIds: ["PC_1", "NPC_1"],
      placements: [
        { actorId: "PC_1", x: 0, y: 0 },
        { actorId: "NPC_1", x: 1, y: 0 },
      ],
    };
    const result = combatStart(effect as Extract<Effect, { op: "combatStart" }>, storyPack, saveWithBoth);

    expect(result.save.actorsById["PC_1"].conditions?.shock).toBeUndefined();
  });

  it("should place party members using partyPlacement area", () => {
    const storyPack = makeTestStoryPack();
    const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 50 } as any });
    const actor2 = makeTestActor({ id: "PC_2", stats: { INI: 40 } as any });
    const actor3 = makeTestActor({ id: "NPC_1", stats: { INI: 30 } as any });
    const save = makeTestSave(storyPack, actor1);
    const saveWithParty = {
      ...save,
      party: { actors: ["PC_1", "PC_2"], activeActorId: "PC_1" },
      actorsById: {
        ...save.actorsById,
        [actor2.id]: actor2,
        [actor3.id]: actor3,
      },
    };

    const effect: Effect = {
      op: "combatStart",
      participantIds: ["NPC_1"],
      grid: { width: 6, height: 6 },
      placements: [{ actorId: "NPC_1", x: 5, y: 5 }],
      partyPlacement: { kind: "area", x: 1, y: 1, width: 2, height: 1 },
    };
    const result = combatStart(effect as Extract<Effect, { op: "combatStart" }>, storyPack, saveWithParty);

    const positions = result.save.runtime.combat?.positions || {};
    expect(positions["PC_1"]).toBeDefined();
    expect(positions["PC_2"]).toBeDefined();
    const allowedCells = new Set(["1,1", "2,1"]);
    expect(allowedCells.has(`${positions["PC_1"]?.x},${positions["PC_1"]?.y}`)).toBe(true);
    expect(allowedCells.has(`${positions["PC_2"]?.x},${positions["PC_2"]?.y}`)).toBe(true);
  });
});
