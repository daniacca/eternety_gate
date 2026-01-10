import { describe, it, expect } from "vitest";
import { combatMove } from "./move";
import { makeTestSave } from "../../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../../test-helpers/makeTestActor";
import { startCombat } from "../combat";
import type { Effect, GameSave } from "../../types";

describe("combatMove", () => {
  it("should move actor north and consume movement", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);
    const saveWithPosition = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          positions: {
            PC_1: { x: 5, y: 5 },
          },
          turn: {
            ...combatSave.runtime.combat!.turn,
            moveRemaining: 3,
          },
        },
      },
    };

    const effect: Effect = { op: "combatMove", dir: "N" };
    const result = combatMove(effect as Extract<Effect, { op: "combatMove" }>, saveWithPosition);

    expect(result.save.runtime.combat?.positions?.["PC_1"]).toEqual({ x: 5, y: 4 });
    expect(result.save.runtime.combat?.turn.moveRemaining).toBe(2);
    expect(result.save.runtime.lastCheck?.success).toBe(true);
  });

  it("should move actor in all directions correctly", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);

    const directions: Array<"N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW"> = [
      "N",
      "NE",
      "E",
      "SE",
      "S",
      "SW",
      "W",
      "NW",
    ];
    const expectedPositions = [
      { x: 0, y: -1 }, // N
      { x: 1, y: -1 }, // NE
      { x: 1, y: 0 }, // E
      { x: 1, y: 1 }, // SE
      { x: 0, y: 1 }, // S
      { x: -1, y: 1 }, // SW
      { x: -1, y: 0 }, // W
      { x: -1, y: -1 }, // NW
    ];

    for (let i = 0; i < directions.length; i++) {
      const dir = directions[i];
      const expectedDelta = expectedPositions[i];
      const saveWithPosition = {
        ...combatSave,
        runtime: {
          ...combatSave.runtime,
          combat: {
            ...combatSave.runtime.combat!,
            positions: {
              PC_1: { x: 5, y: 5 },
            },
            turn: {
              ...combatSave.runtime.combat!.turn,
              moveRemaining: 10,
            },
          },
        },
      };

      const effect: Effect = { op: "combatMove", dir };
      const result = combatMove(effect as Extract<Effect, { op: "combatMove" }>, saveWithPosition);

      expect(result.save.runtime.combat?.positions?.["PC_1"]).toEqual({
        x: 5 + expectedDelta.x,
        y: 5 + expectedDelta.y,
      });
    }
  });

  it("should clamp position to grid bounds", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"], undefined, { width: 10, height: 10 });
    const saveAtEdge = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          positions: {
            PC_1: { x: 0, y: 0 },
          },
          turn: {
            ...combatSave.runtime.combat!.turn,
            moveRemaining: 5,
          },
        },
      },
    };

    // Try to move NW (would go to -1, -1)
    const effect: Effect = { op: "combatMove", dir: "NW" };
    const result = combatMove(effect as Extract<Effect, { op: "combatMove" }>, saveAtEdge);

    // Should be clamped to grid bounds (0, 0)
    expect(result.save.runtime.combat?.positions?.["PC_1"]).toEqual({ x: 0, y: 0 });
  });

  it("should return unchanged save if combat is not active", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1" });
    const save = makeTestSave(storyPack, actor);

    const effect: Effect = { op: "combatMove", dir: "N" };
    const result = combatMove(effect as Extract<Effect, { op: "combatMove" }>, save);

    expect(result.save.runtime.lastCheck?.tags).toContain("combat:move:ignored");
    expect(result.save.runtime.combat).toBeUndefined();
  });

  it("should block if not player's turn", () => {
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
    const combatSave = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);
    const npcTurnSave = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          currentIndex: combatSave.runtime.combat!.participants.indexOf("NPC_1"),
        },
      },
    };

    const effect: Effect = { op: "combatMove", dir: "N" };
    const result = combatMove(effect as Extract<Effect, { op: "combatMove" }>, npcTurnSave);

    // When it's not player's turn, getCurrentTurnActorId returns NPC_1, but activeActorId is PC_1
    // So turnActorId exists but doesn't match activeActorId, which causes the block
    expect(result.save.runtime.lastCheck?.success).toBe(false);
    // The tag format might be different - check if it contains blocked
    expect(result.save.runtime.lastCheck?.tags?.some((tag) => tag.includes("blocked"))).toBe(true);
  });

  it("should block if movement exhausted", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);
    const saveWithNoMovement = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          turn: {
            ...combatSave.runtime.combat!.turn,
            moveRemaining: 0,
          },
        },
      },
    };

    const effect: Effect = { op: "combatMove", dir: "N" };
    const result = combatMove(effect as Extract<Effect, { op: "combatMove" }>, saveWithNoMovement);

    expect(result.save.runtime.lastCheck?.success).toBe(false);
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:blocked=movementExhausted");
  });

  it("should consume 1 movement per move", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);
    const saveWithMovement = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          positions: {
            PC_1: { x: 5, y: 5 },
          },
          turn: {
            ...combatSave.runtime.combat!.turn,
            moveRemaining: 5,
          },
        },
      },
    };

    const effect: Effect = { op: "combatMove", dir: "E" };
    const result = combatMove(effect as Extract<Effect, { op: "combatMove" }>, saveWithMovement);

    expect(result.save.runtime.combat?.turn.moveRemaining).toBe(4);
  });

  it("should return unchanged save for invalid direction", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);

    const effect = { op: "combatMove", dir: "INVALID" as any };
    const result = combatMove(effect as Extract<Effect, { op: "combatMove" }>, combatSave);

    expect(result.save).toEqual(combatSave);
  });

  it("should block movement if target position is occupied by living actor", () => {
    const storyPack = makeTestStoryPack();
    const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const actor2 = makeTestActor({ id: "NPC_1", stats: { INI: 30, AGI: 30 } as any });
    const save = makeTestSave(storyPack, actor1);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [actor2.id]: actor2,
      },
    };
    const combatSave = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);
    const saveWithPositions = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          positions: {
            PC_1: { x: 5, y: 5 },
            NPC_1: { x: 6, y: 5 }, // NPC is to the east
          },
          turn: {
            ...combatSave.runtime.combat!.turn,
            moveRemaining: 5,
          },
        },
      },
    };

    // Try to move east (where NPC is)
    const effect: Effect = { op: "combatMove", dir: "E" };
    const result = combatMove(effect as Extract<Effect, { op: "combatMove" }>, saveWithPositions);

    expect(result.save.runtime.lastCheck?.success).toBe(false);
    expect(result.save.runtime.lastCheck?.tags?.some((tag) => tag.includes("positionOccupied"))).toBe(true);
    expect(result.save.runtime.combat?.positions?.["PC_1"]).toEqual({ x: 5, y: 5 }); // Position unchanged
  });

  it("should allow movement through dead actors", () => {
    const storyPack = makeTestStoryPack();
    const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const actor2 = makeTestActor({
      id: "NPC_1",
      stats: { INI: 30, AGI: 30 } as any,
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
    const combatSave = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);
    const saveWithPositions = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          positions: {
            PC_1: { x: 5, y: 5 },
            NPC_1: { x: 6, y: 5 }, // Dead NPC is to the east
          },
          turn: {
            ...combatSave.runtime.combat!.turn,
            moveRemaining: 5,
          },
        },
      },
    };

    // Should be able to move through dead actor
    const effect: Effect = { op: "combatMove", dir: "E" };
    const result = combatMove(effect as Extract<Effect, { op: "combatMove" }>, saveWithPositions);

    expect(result.save.runtime.lastCheck?.success).toBe(true);
    expect(result.save.runtime.combat?.positions?.["PC_1"]).toEqual({ x: 6, y: 5 });
  });

  it("should reset channeling when moving", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);
    const saveWithChanneling: GameSave = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          positions: {
            PC_1: { x: 5, y: 5 },
          },
          channeling: {
            actorId: "PC_1",
            accumulatedDoS: 4,
            lastChannelTurnCounter: 1,
          },
          turn: {
            ...combatSave.runtime.combat!.turn,
            moveRemaining: 5,
          },
        },
      },
    };

    const effect: Effect = { op: "combatMove", dir: "N" };
    const result = combatMove(effect as Extract<Effect, { op: "combatMove" }>, saveWithChanneling);

    expect(result.save.runtime.combat?.channeling).toBeUndefined();
  });
});
