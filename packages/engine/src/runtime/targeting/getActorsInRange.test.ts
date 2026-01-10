import { describe, it, expect } from "vitest";
import type { GameSave, ActorId } from "../types";
import { getActorsInRange } from "./getActorsInRange";
import { RNG } from "../rng";

describe("getActorsInRange", () => {
  const createMockSave = (): GameSave => {
    return {
      saveVersion: "1.0.0",
      story: { id: "test", version: "1.0.0" },
      state: { flags: {}, counters: {} },
      party: { actors: ["actor1"], activeActorId: "actor1" },
      actorsById: {
        actor1: {
          id: "actor1",
          kind: "PC",
          name: "Player",
          resources: { wounds: 0 },
          status: {},
        },
        actor2: {
          id: "actor2",
          kind: "NPC",
          name: "Enemy 1",
          resources: { wounds: 0 },
          status: {},
        },
        actor3: {
          id: "actor3",
          kind: "NPC",
          name: "Enemy 2",
          resources: { wounds: 0 },
          status: {},
        },
        actor4: {
          id: "actor4",
          kind: "NPC",
          name: "Dead Enemy",
          resources: { wounds: 0, isDead: true },
          status: {},
        },
      },
      runtime: {
        currentSceneId: "test",
        rngSeed: 12345,
        rngCounter: 0,
        combat: {
          active: true,
          participants: ["actor1", "actor2", "actor3", "actor4"],
          currentIndex: 0,
          round: 1,
          grid: { width: 10, height: 10 },
          positions: {
            actor1: { x: 5, y: 5 }, // Center
            actor2: { x: 6, y: 5 }, // Distance 1
            actor3: { x: 7, y: 5 }, // Distance 2
            actor4: { x: 8, y: 5 }, // Distance 3 (dead)
          },
          turn: { moveRemaining: 0, actionAvailable: false },
          turnCounter: 1,
        },
      },
    } as GameSave;
  };

  it("should return actors within range", () => {
    const save = createMockSave();
    const actors = getActorsInRange(save, "actor1", 2);

    // Should include actor2 (distance 1) and actor3 (distance 2)
    // Should exclude actor1 (caster) and actor4 (dead)
    expect(actors).toHaveLength(2);
    expect(actors).toContain("actor2");
    expect(actors).toContain("actor3");
    expect(actors).not.toContain("actor1");
    expect(actors).not.toContain("actor4");
  });

  it("should include caster if includeCaster is true", () => {
    const save = createMockSave();
    const actors = getActorsInRange(save, "actor1", 2, { includeCaster: true });

    expect(actors).toContain("actor1");
  });

  it("should exclude dead actors", () => {
    const save = createMockSave();
    const actors = getActorsInRange(save, "actor1", 5);

    expect(actors).not.toContain("actor4");
  });

  it("should exclude specified actor", () => {
    const save = createMockSave();
    const actors = getActorsInRange(save, "actor1", 2, { excludeActorId: "actor2" });

    expect(actors).toHaveLength(1);
    expect(actors).toContain("actor3");
    expect(actors).not.toContain("actor2");
  });

  it("should return empty array if no actors in range", () => {
    const save = createMockSave();
    const actors = getActorsInRange(save, "actor1", 0);

    expect(actors).toHaveLength(0);
  });

  it("should return empty array if combat not active", () => {
    const save = createMockSave();
    save.runtime.combat = undefined;
    const actors = getActorsInRange(save, "actor1", 5);

    expect(actors).toHaveLength(0);
  });

  it("should sort by distance then actorId", () => {
    const save = createMockSave();
    // Add more actors at different distances
    save.actorsById!["actor5"] = {
      id: "actor5",
      kind: "NPC",
      name: "Enemy 3",
      resources: { wounds: 0 },
      status: {},
    };
    save.runtime.combat!.participants.push("actor5");
    save.runtime.combat!.positions["actor5"] = { x: 5, y: 6 }; // Distance 1

    const actors = getActorsInRange(save, "actor1", 3);

    // actor2 and actor5 are both distance 1, should be sorted by ID
    // actor3 is distance 2
    expect(actors[0]).toBe("actor2"); // Distance 1, ID comes first
    expect(actors[1]).toBe("actor5"); // Distance 1, ID comes second
    expect(actors[2]).toBe("actor3"); // Distance 2
  });
});
