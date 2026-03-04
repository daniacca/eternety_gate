import { describe, it, expect } from "vitest";
import type { GameSave, Actor, ActorId } from "../types";
import { getMcMax, getMcCurrent, setMcCurrent, ensureMcReserve } from "./od";
import { makeTestActor } from "../test-helpers/makeTestActor";

function createSave(actor: Actor): GameSave {
  return {
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
  } as GameSave;
}

describe("getMcMax", () => {
  it("returns INT + WIL + CHA bonus (floor(stat/10) each)", () => {
    const actor = makeTestActor({
      stats: { INT: 5, WIL: 5, CHA: 5 },
    });
    const save = createSave(actor);
    expect(getMcMax(save, actor.id as ActorId)).toBe(0);
  });

  it("returns 3 for 35 in each of INT, WIL, CHA", () => {
    const actor = makeTestActor({
      stats: { INT: 35, WIL: 35, CHA: 35 },
    });
    const save = createSave(actor);
    expect(getMcMax(save, actor.id as ActorId)).toBe(9);
  });

  it("returns at least 0", () => {
    const actor = makeTestActor({
      stats: { INT: 0, WIL: 0, CHA: 0 },
    });
    const save = createSave(actor);
    expect(getMcMax(save, actor.id as ActorId)).toBe(0);
  });

  it("multiplies base by X when actor has trait:magic_core with param x", () => {
    const actor = makeTestActor({
      stats: { INT: 30, WIL: 30, CHA: 30 },
      traits: { "trait:magic_core": { x: 2 } },
    });
    const save = createSave(actor);
    expect(getMcMax(save, actor.id as ActorId)).toBe(18);
  });

  it("treats magic_core without valid x as multiplier 1", () => {
    const actor = makeTestActor({
      stats: { INT: 35, WIL: 35, CHA: 35 },
      traits: { "trait:magic_core": {} },
    });
    const save = createSave(actor);
    expect(getMcMax(save, actor.id as ActorId)).toBe(9);
  });
});

describe("getMcCurrent", () => {
  it("returns mcCurrent when set, clamped to mcMax", () => {
    const actor = makeTestActor({
      resources: { wounds: 0, rf: 0, peq: 100, mcMax: 10, mcCurrent: 5 },
    });
    expect(getMcCurrent(actor, 10)).toBe(5);
  });

  it("returns mcMax when mcCurrent undefined (full reserve)", () => {
    const actor = makeTestActor({
      resources: { wounds: 0, rf: 0, peq: 100, mcMax: 10 },
    });
    expect(getMcCurrent(actor, 10)).toBe(10);
  });

  it("clamps mcCurrent to mcMax", () => {
    const actor = makeTestActor({
      resources: { wounds: 0, rf: 0, peq: 100, mcMax: 10, mcCurrent: 15 },
    });
    expect(getMcCurrent(actor, 10)).toBe(10);
  });
});

describe("setMcCurrent", () => {
  it("clamps value to [0, mcMax]", () => {
    const actor = makeTestActor({
      resources: { wounds: 0, rf: 0, peq: 100, mcMax: 10, mcCurrent: 10 },
    });
    const save = createSave(actor);
    const updated = setMcCurrent(save, actor.id as ActorId, 5, 10);
    expect(updated.actorsById[actor.id].resources.mcCurrent).toBe(5);
  });

  it("does not allow mcCurrent above mcMax", () => {
    const actor = makeTestActor({
      resources: { wounds: 0, rf: 0, peq: 100, mcMax: 10, mcCurrent: 10 },
    });
    const save = createSave(actor);
    const updated = setMcCurrent(save, actor.id as ActorId, 20, 10);
    expect(updated.actorsById[actor.id].resources.mcCurrent).toBe(10);
  });
});

describe("ensureMcReserve", () => {
  it("sets mcMax and mcCurrent when missing", () => {
    const actor = makeTestActor({
      stats: { INT: 50, WIL: 50, CHA: 50 },
      resources: { wounds: 0, rf: 0, peq: 100 },
    });
    delete (actor.resources as any).mcMax;
    delete (actor.resources as any).mcCurrent;
    const save = createSave(actor);
    const updated = ensureMcReserve(save, actor.id as ActorId);
    const r = updated.actorsById[actor.id].resources;
    expect(r.mcMax).toBe(15);
    expect(r.mcCurrent).toBe(15);
  });

  it("does not overwrite when already set", () => {
    const actor = makeTestActor({
      resources: { wounds: 0, rf: 0, peq: 100, mcMax: 20, mcCurrent: 5 },
    });
    const save = createSave(actor);
    const updated = ensureMcReserve(save, actor.id as ActorId);
    expect(updated.actorsById[actor.id].resources.mcMax).toBe(20);
    expect(updated.actorsById[actor.id].resources.mcCurrent).toBe(5);
  });
});
