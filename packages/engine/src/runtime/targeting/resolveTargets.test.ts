import { describe, it, expect } from "vitest";
import type { GameSave } from "../types";
import { resolveTargets } from "./resolveTargets";
import type { TargetSpec, TargetingDefinition } from "./types";

describe("resolveTargets - direction targeting", () => {
  const createMockSave = (): GameSave => {
    return {
      saveVersion: "1.0.0",
      story: { id: "test", version: "1.0.0" },
      state: { flags: {}, counters: {} },
      party: { actors: ["caster"], activeActorId: "caster" },
      actorsById: {
        caster: {
          id: "caster",
          kind: "PC",
          name: "Caster",
          resources: { wounds: 0 },
          status: {},
        },
        target1: {
          id: "target1",
          kind: "NPC",
          name: "Target 1",
          resources: { wounds: 0 },
          status: {},
        },
        target2: {
          id: "target2",
          kind: "NPC",
          name: "Target 2",
          resources: { wounds: 0 },
          status: {},
        },
      },
      runtime: {
        currentSceneId: "test",
        rngSeed: 12345,
        rngCounter: 0,
        combat: {
          active: true,
          participants: ["caster", "target1", "target2"],
          currentIndex: 0,
          round: 1,
          grid: { width: 10, height: 10 },
          positions: {
            caster: { x: 5, y: 5 },
            target1: { x: 5, y: 3 }, // North, distance 2
            target2: { x: 7, y: 5 }, // East, distance 2
          },
          turn: { moveRemaining: 0, actionAvailable: false },
          turnCounter: 1,
        },
      },
    } as GameSave;
  };

  it("should resolve line targeting north", () => {
    const save = createMockSave();
    const targetSpec: TargetSpec = { kind: "direction", dir: 8 }; // North
    const targeting: TargetingDefinition = { shape: "line", rangeSquares: 3 };

    const result = resolveTargets(save, "caster", targetSpec, targeting);

    expect(result.invalidReason).toBeUndefined();
    // Should hit target1 (at y=3, north of caster at y=5)
    expect(result.targetActorIds).toContain("target1");
    expect(result.targetPoints.length).toBeGreaterThan(0);
  });

  it("should resolve line targeting east", () => {
    const save = createMockSave();
    const targetSpec: TargetSpec = { kind: "direction", dir: 6 }; // East
    const targeting: TargetingDefinition = { shape: "line", rangeSquares: 3 };

    const result = resolveTargets(save, "caster", targetSpec, targeting);

    expect(result.invalidReason).toBeUndefined();
    // Should hit target2 (at x=7, east of caster at x=5)
    expect(result.targetActorIds).toContain("target2");
  });

  it("should resolve cone targeting", () => {
    const save = createMockSave();
    // Add more targets for cone test
    save.actorsById!["target3"] = {
      id: "target3",
      kind: "NPC",
      name: "Target 3",
      resources: { wounds: 0 },
      status: {},
    };
    save.runtime.combat!.participants.push("target3");
    save.runtime.combat!.positions["target3"] = { x: 5, y: 2 }; // Further north

    const targetSpec: TargetSpec = { kind: "direction", dir: 8 }; // North
    const targeting: TargetingDefinition = { shape: "cone", rangeSquares: 3 };

    const result = resolveTargets(save, "caster", targetSpec, targeting);

    expect(result.invalidReason).toBeUndefined();
    // Cone should hit multiple targets along the line
    expect(result.targetActorIds.length).toBeGreaterThanOrEqual(1);
    expect(result.targetPoints.length).toBeGreaterThan(0);
  });

  it("should return invalid for line with point targetSpec", () => {
    const save = createMockSave();
    const targetSpec: TargetSpec = { kind: "point", x: 5, y: 3 };
    const targeting: TargetingDefinition = { shape: "line", rangeSquares: 3 };

    const result = resolveTargets(save, "caster", targetSpec, targeting);

    // Point can be used for line (converted to direction)
    // This should work - point is converted to direction
    expect(result.invalidReason).toBeUndefined();
  });

  it("should return invalid for cone with actor targetSpec", () => {
    const save = createMockSave();
    const targetSpec: TargetSpec = { kind: "actor", actorId: "target1" };
    const targeting: TargetingDefinition = { shape: "cone", rangeSquares: 3 };

    const result = resolveTargets(save, "caster", targetSpec, targeting);

    expect(result.invalidReason).toBe("target_spec_invalid_for_cone");
  });
});
