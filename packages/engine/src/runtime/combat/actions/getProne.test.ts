import { describe, it, expect } from "vitest";
import { combatGetProne } from "./getProne";
import { makeTestSave } from "../../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../../test-helpers/makeTestActor";
import { startCombat } from "../combat";
import type { Effect } from "../../types";

describe("combatGetProne", () => {
  it("should add prone condition and consume all movement", () => {
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
          turn: {
            ...combatSave.runtime.combat!.turn,
            moveRemaining: 5,
          },
        },
      },
    };

    const effect: Effect = { op: "combatGetProne", actorId: "PC_1" };
    const result = combatGetProne(effect as Extract<Effect, { op: "combatGetProne" }>, saveWithMovement);

    expect(result.emittedEffects).toBeDefined();
    expect(result.emittedEffects?.length).toBe(1);
    expect(result.emittedEffects?.[0]).toEqual({
      op: "addCondition",
      actorId: "PC_1",
      condition: "prone",
      source: "getProne",
    });
    expect(result.save.runtime.combat?.turn.moveRemaining).toBe(0);
    expect(result.save.runtime.combatLog).toBeDefined();
  });

  it("should return unchanged save if combat is not active", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1" });
    const save = makeTestSave(storyPack, actor);

    const effect: Effect = { op: "combatGetProne", actorId: "PC_1" };
    const result = combatGetProne(effect as Extract<Effect, { op: "combatGetProne" }>, save);

    expect(result.save).toEqual(save);
    expect(result.emittedEffects).toBeUndefined();
  });

  it("should return unchanged save if not actor's turn", () => {
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

    const effect: Effect = { op: "combatGetProne", actorId: "PC_1" };
    const result = combatGetProne(effect as Extract<Effect, { op: "combatGetProne" }>, npcTurnSave);

    expect(result.save).toEqual(npcTurnSave);
    expect(result.emittedEffects).toBeUndefined();
  });

  it("should return unchanged save if no movement remaining", () => {
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

    const effect: Effect = { op: "combatGetProne", actorId: "PC_1" };
    const result = combatGetProne(effect as Extract<Effect, { op: "combatGetProne" }>, saveWithNoMovement);

    expect(result.save.runtime.combat?.turn.moveRemaining).toBe(0);
    expect(result.emittedEffects).toBeUndefined();
  });

  it("should add narration for PC actor", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", kind: "PC", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);

    const effect: Effect = { op: "combatGetProne", actorId: "PC_1" };
    const result = combatGetProne(effect as Extract<Effect, { op: "combatGetProne" }>, combatSave);

    const lastLog = result.save.runtime.combatLog?.[result.save.runtime.combatLog.length - 1];
    expect(lastLog).toContain("Ti metti a terra");
  });
});
